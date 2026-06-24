using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace AIHub.Windows;

public partial class MainWindow : Window
{
    private readonly AppDatabase _database;
    private readonly ThemeService _theme = new();
    private readonly Dictionary<ProviderId, ProviderRuntime> _runtimes = [];
    private readonly Dictionary<ProviderId, Button> _providerTabs = [];
    private readonly Dictionary<ProviderId, string> _pendingUserMessages = [];
    private readonly Dictionary<ProviderId, StreamingMessageState> _streamingMessages = [];
    private readonly Dictionary<ProviderId, Task> _providerPreparation = [];
    private readonly ObservableCollection<AttachmentDraft> _attachments = [];
    private readonly ObservableCollection<MessageDisplay> _messageDisplays = [];
    private ConversationRecord? _selectedConversation;
    private string? _displayedConversationId;
    private ProviderId _currentProvider = ProviderId.Doubao;
    private string? _editParentId;
    private bool _drawerOpen;
    private bool _isGenerating;
    private bool _autoScroll = true;
    private bool _loadingDraft;

    public MainWindow()
    {
        InitializeComponent();
        MessageList.ItemsSource = _messageDisplays;
        var appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AIHub.Native");
        _database = new AppDatabase(Path.Combine(appData, "aihub.sqlite"));
        foreach (var definition in ProviderCatalog.All)
        {
            var runtime = new ProviderRuntime(
                definition, BrowserHost, Path.Combine(appData, "WebView2"));
            runtime.BridgeEvent += Runtime_OnBridgeEvent;
            _runtimes.Add(definition.Id, runtime);
        }

        BuildProviderTabs();
        SelectProvider(_currentProvider);
        RefreshProviderTabs();
        if (Environment.GetCommandLineArgs().Contains(
            "--adapter-audit", StringComparer.OrdinalIgnoreCase))
        {
            ShowInTaskbar = false;
            WindowStyle = WindowStyle.None;
            Left = -30000;
            Top = -30000;
            Width = 1280;
            Height = 900;
            Loaded += async (_, _) => await RunAdapterAuditAsync();
        }
        Closed += (_, _) =>
        {
            _streamingMessages.Clear();
            SaveDraft();
            foreach (var runtime in _runtimes.Values) runtime.Dispose();
            _database.Dispose();
            _theme.Dispose();
        };
    }

    private async Task RunAdapterAuditAsync()
    {
        var reports = new List<AdapterAuditReport>();
        var providerArgument = Environment.GetCommandLineArgs()
            .FirstOrDefault(value => value.StartsWith(
                "--audit-providers=", StringComparison.OrdinalIgnoreCase));
        var selectedProviders = providerArgument is null
            ? null
            : providerArgument.Split('=', 2)[1]
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(value => Enum.TryParse<ProviderId>(
                    value, true, out var provider) ? provider : (ProviderId?)null)
                .Where(value => value.HasValue)
                .Select(value => value!.Value)
                .ToHashSet();
        const string prompt =
            "AIHub adapter audit. Reply in Markdown with exactly two bullets: provider name and current date.";
        foreach (var definition in ProviderCatalog.All.Where(definition =>
                     selectedProviders is null || selectedProviders.Contains(definition.Id)))
        {
            try
            {
                reports.Add(await _runtimes[definition.Id].RunAuditAsync(
                    prompt,
                    TimeSpan.FromSeconds(80)));
            }
            catch (Exception exception)
            {
                reports.Add(new AdapterAuditReport(
                    definition.Id,
                    "",
                    _runtimes[definition.Id].IsAuthenticated,
                    "exception",
                    null,
                    exception.Message,
                    [],
                    DateTimeOffset.UtcNow));
            }
        }

        var diagnostics = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AIHub.Native",
            "diagnostics");
        Directory.CreateDirectory(diagnostics);
        var path = Path.Combine(diagnostics, "adapter-audit.json");
        await File.WriteAllTextAsync(
            path,
            JsonSerializer.Serialize(reports, new JsonSerializerOptions
            {
                WriteIndented = true,
            }));
        Application.Current.Shutdown();
    }

    private void BuildProviderTabs()
    {
        foreach (var definition in ProviderCatalog.All)
        {
            var tab = new Button
            {
                Tag = definition.Id,
                Content = $"{definition.Glyph}  {definition.Label}",
                MinWidth = 92,
                ToolTip = $"切换到 {definition.Label}",
            };
            tab.Click += ProviderTab_OnClick;
            ProviderStrip.Children.Add(tab);
            _providerTabs[definition.Id] = tab;
        }
    }

    private void ProviderTab_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: ProviderId provider }) SelectProvider(provider);
    }

    private void SelectProvider(ProviderId provider)
    {
        SaveDraft();
        _currentProvider = provider;
        foreach (var definition in ProviderCatalog.All)
        {
            var selected = definition.Id == provider;
            _providerTabs[definition.Id].BorderBrush = new SolidColorBrush(
                (Color)ColorConverter.ConvertFromString(
                    selected ? definition.AccentColor : "#34394A"));
            _providerTabs[definition.Id].BorderThickness =
                selected ? new Thickness(2) : new Thickness(1);
        }

        var first = _database.GetConversations()
            .FirstOrDefault(item => item.Provider == provider);
        if (first is not null)
        {
            SelectConversation(first);
        }
        else
        {
            _selectedConversation = null;
            var definition = ProviderCatalog.Get(provider);
            ConversationTitle.Text = $"开始与 {definition.Label} 对话";
            ProviderBadgeText.Text = definition.Glyph;
            ProviderBadge.Background = AccentBrush(provider);
            _displayedConversationId = null;
            _messageDisplays.Clear();
            _loadingDraft = true;
            ComposerBox.Clear();
            _loadingDraft = false;
        }
        RefreshConversationGroups();
        RefreshCapabilities();
    }

    private async void NewCurrentConversation_OnClick(object sender, RoutedEventArgs e) =>
        await CreateConversationAsync(_currentProvider);

    private async Task CreateConversationAsync(ProviderId provider)
    {
        try
        {
            await _runtimes[provider].EnsureInitializedAsync();
            var conversation = _database.CreateConversation(provider);
            SelectConversation(conversation);
            var preparation = PrepareProviderConversationAsync(provider);
            _providerPreparation[provider] = preparation;
        }
        catch (Exception exception)
        {
            ShowToast(exception.Message);
        }
    }

    private async Task PrepareProviderConversationAsync(ProviderId provider)
    {
        try
        {
            await _runtimes[provider].StartNewConversationAsync();
        }
        catch (Exception exception)
        {
            Dispatcher.Invoke(() => ShowToast(exception.Message));
        }
    }

    private void SelectConversation(ConversationRecord record)
    {
        SaveDraft();
        _selectedConversation = record;
        _currentProvider = record.Provider;
        _editParentId = null;
        var definition = ProviderCatalog.Get(record.Provider);
        ProviderBadgeText.Text = definition.Glyph;
        ProviderBadge.Background = AccentBrush(record.Provider);
        ConversationTitle.Text = record.Title;
        _loadingDraft = true;
        ComposerBox.Text = record.Draft;
        _loadingDraft = false;
        RefreshMessages();
        RefreshCapabilities();
        RefreshConversationGroups();
    }

    private void RefreshConversationGroups()
    {
        ConversationGroups.Items.Clear();
        var query = ConversationSearch.Text.Trim();
        var conversations = _database.GetConversations();
        foreach (var definition in ProviderCatalog.All)
        {
            var groupItems = conversations
                .Where(item => item.Provider == definition.Id)
                .Where(item => string.IsNullOrEmpty(query) ||
                    item.Title.Contains(query, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (groupItems.Count == 0 && !string.IsNullOrEmpty(query)) continue;

            var panel = new StackPanel();
            foreach (var conversation in groupItems)
                panel.Children.Add(CreateConversationRow(conversation));
            ConversationGroups.Items.Add(new Expander
            {
                Header = $"{definition.Glyph}  {definition.Label}  {groupItems.Count}",
                IsExpanded = definition.Id == _currentProvider,
                Margin = new Thickness(10, 4, 10, 0),
                Content = panel,
            });
        }
    }

    private FrameworkElement CreateConversationRow(ConversationRecord conversation)
    {
        var grid = new Grid { Margin = new Thickness(0, 2, 0, 2) };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var select = new Button
        {
            Content = $"{(conversation.IsPinned ? "★ " : "")}{conversation.Title}",
            Tag = conversation,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            ToolTip = conversation.Title,
        };
        select.Click += (_, _) => SelectConversation((ConversationRecord)select.Tag);
        grid.Children.Add(select);
        var more = new Button
        {
            Content = "⋯",
            Tag = conversation,
            Padding = new Thickness(8, 5, 8, 5),
        };
        more.Click += ConversationMenu_OnClick;
        Grid.SetColumn(more, 1);
        grid.Children.Add(more);
        return grid;
    }

    private void ConversationMenu_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: ConversationRecord record } button) return;
        var menu = new ContextMenu();
        menu.Items.Add(CreateMenuItem("重命名", () => RenameConversation(record)));
        menu.Items.Add(CreateMenuItem(record.IsPinned ? "取消置顶" : "置顶", () =>
        {
            _database.UpdateConversation(record.Id, pinned: !record.IsPinned);
            RefreshConversationGroups();
        }));
        menu.Items.Add(CreateMenuItem("归档", () =>
        {
            _database.UpdateConversation(record.Id, archived: true);
            ClearIfSelected(record.Id);
            RefreshConversationGroups();
        }));
        menu.Items.Add(CreateMenuItem("删除", () => DeleteConversation(record)));
        button.ContextMenu = menu;
        menu.IsOpen = true;
    }

    private static MenuItem CreateMenuItem(string title, Action action)
    {
        var item = new MenuItem { Header = title };
        item.Click += (_, _) => action();
        return item;
    }

    private void RenameConversation(ConversationRecord record)
    {
        var dialog = new TextPromptWindow("重命名会话", record.Title) { Owner = this };
        if (dialog.ShowDialog() != true || string.IsNullOrWhiteSpace(dialog.Value)) return;
        var title = dialog.Value.Trim();
        _database.UpdateConversation(record.Id, title: title);
        if (_selectedConversation?.Id == record.Id)
        {
            _selectedConversation = record with { Title = title };
            ConversationTitle.Text = title;
        }
        RefreshConversationGroups();
    }

    private void DeleteConversation(ConversationRecord record)
    {
        if (MessageBox.Show(this, $"删除“{record.Title}”及其本地消息？",
                "删除会话", MessageBoxButton.YesNo, MessageBoxImage.Warning) !=
            MessageBoxResult.Yes) return;
        _database.DeleteConversation(record.Id);
        ClearIfSelected(record.Id);
        RefreshConversationGroups();
    }

    private void ClearIfSelected(string id)
    {
        if (_selectedConversation?.Id != id) return;
        _selectedConversation = null;
        _displayedConversationId = null;
        _messageDisplays.Clear();
        ConversationTitle.Text = "选择或新建会话";
    }

    private async void SendButton_OnClick(object sender, RoutedEventArgs e) =>
        await SendCurrentMessageAsync();

    private async Task SendCurrentMessageAsync(string? overrideText = null, string? parentId = null)
    {
        if (_selectedConversation is null)
        {
            await CreateConversationAsync(_currentProvider);
            if (_selectedConversation is null) return;
        }

        var text = (overrideText ?? ComposerBox.Text).Trim();
        if (string.IsNullOrEmpty(text) && _attachments.Count == 0) return;
        var provider = _selectedConversation.Provider;
        var effectiveParent = parentId ?? _editParentId;
        var message = new MessageRecord(
            Guid.NewGuid().ToString("N"), _selectedConversation.Id, provider,
            "user", text, "pending", DateTimeOffset.UtcNow, effectiveParent);
        _database.AddMessage(message);
        _pendingUserMessages[provider] = message.Id;
        var attachmentRecords = _attachments.Select(attachment => new AttachmentRecord(
            Guid.NewGuid().ToString("N"), message.Id, attachment.Name,
            attachment.Kind, attachment.Size, "pending")).ToList();
        foreach (var attachment in attachmentRecords)
            _database.AddAttachment(attachment);
        _editParentId = null;
        ComposerBox.Clear();
        RefreshMessages();

        try
        {
            if (_providerPreparation.Remove(provider, out var preparation))
                await preparation;
            if (_attachments.Count > 0)
            {
                await _runtimes[provider].UploadAttachmentsAsync(
                    _attachments.Select(item => item.Path).ToArray());
                foreach (var attachment in attachmentRecords)
                    _database.UpdateAttachment(attachment.Id, "uploaded");
            }
            _attachments.Clear();
            RefreshAttachmentPanel();
            await _runtimes[provider].SendAsync(text);
            SetGenerating(true);
        }
        catch (Exception exception)
        {
            _database.UpdateMessage(message.Id, text, "failed", exception.Message);
            foreach (var attachment in attachmentRecords)
                _database.UpdateAttachment(attachment.Id, "failed", exception.Message);
            ShowToast(exception.Message);
        }
        RefreshMessages();
    }

    private void Runtime_OnBridgeEvent(object? sender, ProviderBridgeEvent message)
    {
        if (sender is not ProviderRuntime runtime) return;
        Dispatcher.Invoke(() =>
        {
            var provider = runtime.Definition.Id;
            if (message.Type == "auth.changed")
            {
                RefreshProviderTabs();
                return;
            }
            if (message.Type == "message.started")
            {
                if (_pendingUserMessages.Remove(provider, out var userId))
                    _database.UpdateMessage(userId, FindMessageText(userId), "completed");
                if (_selectedConversation?.Provider != provider) return;
                var id = Guid.NewGuid().ToString("N");
                _streamingMessages[provider] = new StreamingMessageState(id);
                _database.AddMessage(new MessageRecord(
                    id, _selectedConversation.Id, provider, "assistant", "",
                    "streaming", DateTimeOffset.UtcNow));
                SetGenerating(true);
            }
            else if (message.Type == "message.delta" &&
                     message.Text is not null &&
                     _streamingMessages.TryGetValue(provider, out var streaming))
            {
                streaming.RawText += message.Text;
                streaming.LastChunkAt = DateTime.UtcNow;
                QueueStreamingRender(provider, streaming);
            }
            else if (message.Type == "message.snapshot" &&
                     message.Text is not null &&
                     _streamingMessages.TryGetValue(provider, out var snapshot))
            {
                snapshot.RawText = message.Text;
                snapshot.LastChunkAt = DateTime.UtcNow;
                QueueStreamingRender(provider, snapshot);
            }
            else if (message.Type == "message.completed" &&
                     _streamingMessages.Remove(provider, out var completed))
            {
                var finalText = TextEncodingRepair.Normalize(
                    message.Text ?? completed.RawText);
                _database.UpdateMessage(
                    completed.Id, finalText, "completed");
                SetGenerating(false);
            }
            else if (message.Type is "generation.failed" or "command.failed" or "adapter.degraded")
            {
                if (_pendingUserMessages.Remove(provider, out var userId))
                    _database.UpdateMessage(
                        userId,
                        FindMessageText(userId),
                        "failed",
                        message.Reason ?? message.Type);
                if (_streamingMessages.Remove(provider, out var failed))
                    _database.UpdateMessage(
                        failed.Id,
                        TextEncodingRepair.Normalize(failed.RawText),
                        "failed",
                        message.Reason ?? message.Type);
                SetGenerating(false);
                ShowToast(message.Reason ?? "网站适配器执行失败。");
            }
            RefreshMessages();
        });
    }

    private void QueueStreamingRender(
        ProviderId provider,
        StreamingMessageState streaming)
    {
        if (streaming.RenderLoopRunning) return;
        streaming.RenderLoopRunning = true;
        _ = RenderStreamingMessageAsync(provider, streaming);
    }

    private async Task RenderStreamingMessageAsync(
        ProviderId provider,
        StreamingMessageState streaming)
    {
        while (true)
        {
            await Task.Delay(72);
            var keepRunning = false;
            await Dispatcher.InvokeAsync(() =>
            {
                if (!_streamingMessages.TryGetValue(provider, out var current) ||
                    !ReferenceEquals(current, streaming))
                {
                    return;
                }

                var available = TextEncodingRepair.Normalize(current.RawText);
                var quiet = DateTime.UtcNow - current.LastChunkAt >
                    TimeSpan.FromMilliseconds(140);
                var next = StreamingTextReveal.NextChunk(
                    current.DisplayText,
                    available,
                    quiet);
                if (next is not null && next != current.DisplayText)
                {
                    current.DisplayText = next;
                    _database.UpdateMessage(current.Id, next, "streaming");
                    RefreshMessages();
                }

                keepRunning = current.DisplayText != available;
                if (!keepRunning)
                    current.RenderLoopRunning = false;
            });
            if (!keepRunning) return;
        }
    }

    private void RefreshMessages()
    {
        if (_selectedConversation is null)
        {
            _displayedConversationId = null;
            _messageDisplays.Clear();
            return;
        }
        var definition = ProviderCatalog.Get(_selectedConversation.Provider);
        var userColor = ThemeService.IsLightTheme() ? "#DCE7F8" : "#273248";
        var assistantColor = ThemeService.IsLightTheme() ? "#FFFFFF" : "#181C26";
        var messages = _database.GetMessages(_selectedConversation.Id)
            .Select(message => new MessageDisplay(
                message.Id,
                message.Role == "user" ? "你" : definition.Label,
                TextEncodingRepair.Normalize(message.Text),
                StatusLabel(message.Status, message.ErrorCode),
                message.Role == "assistant",
                message.Role == "user",
                message.Role == "user" ? HorizontalAlignment.Right : HorizontalAlignment.Left,
                new SolidColorBrush((Color)ColorConverter.ConvertFromString(
                    message.Role == "user" ? userColor : assistantColor))))
            .ToList();
        if (_displayedConversationId != _selectedConversation.Id)
        {
            _displayedConversationId = _selectedConversation.Id;
            _messageDisplays.Clear();
        }
        while (_messageDisplays.Count > messages.Count)
            _messageDisplays.RemoveAt(_messageDisplays.Count - 1);
        for (var index = 0; index < messages.Count; index++)
        {
            var incoming = messages[index];
            if (index >= _messageDisplays.Count)
            {
                _messageDisplays.Add(incoming);
            }
            else if (_messageDisplays[index].Id != incoming.Id)
            {
                _messageDisplays[index] = incoming;
            }
            else
            {
                _messageDisplays[index].Update(incoming.Text, incoming.StatusLabel);
            }
        }
        if (_autoScroll)
            Dispatcher.BeginInvoke(() => MessageScroller.ScrollToEnd());
    }

    private static string StatusLabel(string status, string? error) => status switch
    {
        "pending" => "发送中…",
        "streaming" => "生成中…",
        "failed" => string.IsNullOrWhiteSpace(error)
            ? "发送失败"
            : $"发送失败：{TextEncodingRepair.Normalize(error)}",
        "stopped" => "已停止",
        _ => "",
    };

    private void CopyMessage_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: MessageDisplay message })
        {
            Clipboard.SetText(message.Text);
            ShowToast("已复制");
        }
    }

    private async void RetryMessage_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: MessageDisplay message } ||
            _selectedConversation is null) return;
        var messages = _database.GetMessages(_selectedConversation.Id).ToList();
        var assistantIndex = messages.FindIndex(item => item.Id == message.Id);
        var user = messages.Take(Math.Max(0, assistantIndex))
            .LastOrDefault(item => item.Role == "user");
        if (user is not null) await SendCurrentMessageAsync(user.Text, user.Id);
    }

    private void EditMessage_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: MessageDisplay message }) return;
        ComposerBox.Text = message.Text;
        _editParentId = message.Id;
        ComposerBox.Focus();
        ComposerBox.CaretIndex = ComposerBox.Text.Length;
        ShowToast("已进入编辑重发模式");
    }

    private void StopButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (_selectedConversation is null) return;
        _runtimes[_selectedConversation.Provider].Cancel();
        if (_streamingMessages.Remove(_selectedConversation.Provider, out var stopped))
            _database.UpdateMessage(
                stopped.Id,
                TextEncodingRepair.Normalize(stopped.RawText),
                "stopped");
        SetGenerating(false);
        RefreshMessages();
    }

    private void SetGenerating(bool value)
    {
        _isGenerating = value;
        StopButton.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        SendButton.Visibility = value ? Visibility.Collapsed : Visibility.Visible;
        GenerationState.Text = value ? "生成中…" : "";
    }

    private async void ToggleDrawer_OnClick(object sender, RoutedEventArgs e)
    {
        if (_drawerOpen) CloseDrawer();
        else await OpenDrawerAsync(_selectedConversation?.Provider ?? _currentProvider);
    }

    private async Task OpenDrawerAsync(ProviderId provider)
    {
        try
        {
            await _runtimes[provider].ShowAsync();
            foreach (var pair in _runtimes)
                if (pair.Key != provider) pair.Value.Hide();
            DrawerTitle.Text = $"{ProviderCatalog.Get(provider).Label} 官网";
            ProviderWebDrawer.Visibility = Visibility.Visible;
            DrawerColumn.Width = new GridLength(Math.Min(520, ActualWidth * .42));
            DrawerSplitterColumn.Width = new GridLength(6);
            _drawerOpen = true;
        }
        catch (Exception exception)
        {
            ShowToast(exception.Message);
        }
    }

    private void CloseDrawer()
    {
        foreach (var runtime in _runtimes.Values) runtime.Hide();
        ProviderWebDrawer.Visibility = Visibility.Collapsed;
        DrawerColumn.Width = new GridLength(0);
        DrawerSplitterColumn.Width = new GridLength(0);
        _drawerOpen = false;
    }

    private void RenameConversation_OnClick(object sender, RoutedEventArgs e)
    {
        if (_selectedConversation is not null) RenameConversation(_selectedConversation);
    }

    private void PinConversation_OnClick(object sender, RoutedEventArgs e)
    {
        if (_selectedConversation is null) return;
        var pinned = !_selectedConversation.IsPinned;
        _database.UpdateConversation(_selectedConversation.Id, pinned: pinned);
        _selectedConversation = _selectedConversation with { IsPinned = pinned };
        RefreshConversationGroups();
    }

    private void ConversationSearch_OnTextChanged(object sender, TextChangedEventArgs e) =>
        RefreshConversationGroups();

    private void ComposerBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_loadingDraft) SaveDraft();
    }

    private void SaveDraft()
    {
        if (_selectedConversation is not null && !_loadingDraft)
            _database.UpdateConversation(_selectedConversation.Id, draft: ComposerBox.Text);
    }

    private async void ComposerBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
        {
            e.Handled = true;
            if (!_isGenerating) await SendCurrentMessageAsync();
        }
    }

    private void Window_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _isGenerating) StopButton_OnClick(sender, e);
        if (e.Key == Key.K && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            e.Handled = true;
            ConversationSearch.Focus();
            ConversationSearch.SelectAll();
        }
    }

    private void MessageScroller_OnScrollChanged(object sender, ScrollChangedEventArgs e) =>
        _autoScroll = MessageScroller.ScrollableHeight - MessageScroller.VerticalOffset < 36;

    private void RefreshCapabilities()
    {
        CapabilityBar.Items.Clear();
        var capabilities = ProviderCatalog.Get(_currentProvider).Capabilities;
        AttachButton.Visibility = capabilities.Attachments.Count > 0
            ? Visibility.Visible : Visibility.Collapsed;
        foreach (var mode in capabilities.Modes)
            CapabilityBar.Items.Add(new Button { Content = ModeLabel(mode), IsEnabled = false });
    }

    private static string ModeLabel(ProviderMode mode) => mode switch
    {
        ProviderMode.WebSearch => "联网",
        ProviderMode.Reasoning => "深度思考",
        ProviderMode.ImageUnderstanding => "图片理解",
        ProviderMode.ImageGeneration => "图片生成",
        ProviderMode.Coding => "编程",
        _ => "文档",
    };

    private void AttachButton_OnClick(object sender, RoutedEventArgs e)
    {
        var capabilities = ProviderCatalog.Get(_currentProvider).Capabilities;
        if (capabilities.Attachments.Count == 0) return;
        var dialog = new OpenFileDialog
        {
            Multiselect = true,
            Filter = "支持的文件|*.png;*.jpg;*.jpeg;*.webp;*.pdf;*.doc;*.docx;*.xls;*.xlsx;*.ppt;*.pptx;*.txt;*.md",
        };
        if (dialog.ShowDialog(this) != true) return;
        foreach (var path in dialog.FileNames)
        {
            var file = new FileInfo(path);
            var kind = AttachmentType.FromPath(path);
            if (kind is null || !capabilities.Attachments.Contains(kind.Value))
            {
                ShowToast($"{file.Name} 不受当前模型支持。");
                continue;
            }
            _attachments.Add(new AttachmentDraft(path, file.Name, kind.Value, file.Length));
        }
        RefreshAttachmentPanel();
    }

    private void RefreshAttachmentPanel()
    {
        AttachmentPanel.Children.Clear();
        foreach (var attachment in _attachments.ToList())
        {
            var button = new Button
            {
                Content = $"{attachment.Name}  ×",
                ToolTip = $"{attachment.Kind} · {attachment.Size / 1024d:0.#} KB",
                Tag = attachment,
            };
            button.Click += (_, _) =>
            {
                _attachments.Remove((AttachmentDraft)button.Tag);
                RefreshAttachmentPanel();
            };
            AttachmentPanel.Children.Add(button);
        }
    }

    private void Window_OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        SidebarColumn.Width = e.NewSize.Width < 1100 ? new GridLength(0) : new GridLength(286);
        if (e.NewSize.Width < 1180 && _drawerOpen) CloseDrawer();
    }

    private void RefreshProviderTabs()
    {
        foreach (var definition in ProviderCatalog.All)
            _providerTabs[definition.Id].Content =
                $"{definition.Glyph}  {definition.Label}" +
                (_runtimes[definition.Id].IsAuthenticated ? "  ●" : "");
    }

    private string FindMessageText(string id)
    {
        if (_selectedConversation is null) return "";
        return _database.GetMessages(_selectedConversation.Id)
            .FirstOrDefault(item => item.Id == id)?.Text ?? "";
    }

    private void ShowToast(string text)
    {
        ToastText.Text = text;
        ToastHost.Visibility = Visibility.Visible;
        _ = Task.Delay(4200).ContinueWith(_ => Dispatcher.Invoke(() =>
            ToastHost.Visibility = Visibility.Collapsed));
    }

    private static Brush AccentBrush(ProviderId provider) =>
        new SolidColorBrush((Color)ColorConverter.ConvertFromString(
            ProviderCatalog.Get(provider).AccentColor));

    private sealed class MessageDisplay : INotifyPropertyChanged
    {
        private string _text;
        private string _statusLabel;

        public MessageDisplay(
            string id,
            string author,
            string text,
            string statusLabel,
            bool isMarkdown,
            bool isUser,
            HorizontalAlignment alignment,
            Brush background)
        {
            Id = id;
            Author = author;
            _text = text;
            _statusLabel = statusLabel;
            IsMarkdown = isMarkdown;
            IsUser = isUser;
            Alignment = alignment;
            Background = background;
        }

        public string Id { get; }
        public string Author { get; }
        public string Text
        {
            get => _text;
            private set => SetField(ref _text, value);
        }
        public string StatusLabel
        {
            get => _statusLabel;
            private set => SetField(ref _statusLabel, value);
        }
        public bool IsMarkdown { get; }
        public bool IsUser { get; }
        public HorizontalAlignment Alignment { get; }
        public Brush Background { get; }

        public event PropertyChangedEventHandler? PropertyChanged;

        public void Update(string text, string statusLabel)
        {
            Text = text;
            StatusLabel = statusLabel;
        }

        private void SetField(
            ref string field,
            string value,
            [CallerMemberName] string? propertyName = null)
        {
            if (field == value) return;
            field = value;
            PropertyChanged?.Invoke(
                this,
                new PropertyChangedEventArgs(propertyName));
        }
    }

    private sealed class StreamingMessageState(string id)
    {
        public string Id { get; } = id;
        public string RawText { get; set; } = "";
        public string DisplayText { get; set; } = "";
        public DateTime LastChunkAt { get; set; } = DateTime.UtcNow;
        public bool RenderLoopRunning { get; set; }
    }

    private sealed record AttachmentDraft(
        string Path, string Name, AttachmentKind Kind, long Size);
}

public static class AttachmentType
{
    public static AttachmentKind? FromPath(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" or ".jpg" or ".jpeg" or ".webp" => AttachmentKind.Image,
            ".pdf" => AttachmentKind.Pdf,
            ".doc" or ".docx" => AttachmentKind.Word,
            ".xls" or ".xlsx" => AttachmentKind.Excel,
            ".ppt" or ".pptx" => AttachmentKind.PowerPoint,
            ".txt" or ".md" => AttachmentKind.Text,
            _ => null,
        };
}
