using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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
    private readonly Dictionary<ProviderMode, ToggleButton> _modeButtons = [];
    private readonly Dictionary<ProviderId, HashSet<ProviderMode>> _selectedModes = [];
    private readonly HashSet<ProviderId> _modeSelectionsInitialized = [];
    private readonly Dictionary<ProviderId, string> _selectedModels = [];
    private bool _updatingModelSelector;
    private readonly ObservableCollection<AttachmentDraft> _attachments = [];
    private readonly MessageWebView _messageView = new();
    private ConversationRecord? _selectedConversation;
    private ProviderId _currentProvider = ProviderId.Doubao;
    private string? _editParentId;
    private bool _drawerOpen;
    private bool _isGenerating;
    private bool _loadingDraft;

    public MainWindow()
    {
        InitializeComponent();
        MessageViewHost.Children.Add(_messageView.View);
        _messageView.Action += MessageView_OnAction;
        var appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AIHub.Native");
        _database = new AppDatabase(Path.Combine(appData, "aihub.sqlite"));
        foreach (var definition in ProviderCatalog.All)
        {
            var runtime = new ProviderRuntime(
                definition, BrowserHost, WebView2Host, Path.Combine(appData, "WebView2"));
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
            _messageView.Dispose();
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
        _ = WarmProviderAsync(provider);
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
            _ = _messageView.ClearAsync(ThemeService.IsLightTheme());
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
        _ = WarmProviderAsync(record.Provider);
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

    private async Task WarmProviderAsync(ProviderId provider)
    {
        try
        {
            await _runtimes[provider].EnsureInitializedAsync();
        }
        catch
        {
            // Sending and the provider drawer surface actionable errors.
        }
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
        _ = _messageView.ClearAsync(ThemeService.IsLightTheme());
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
        var selectedModes = SelectedModes(provider);
        var selectedModel = _selectedModels.GetValueOrDefault(provider) ??
            _runtimes[provider].Capabilities.Model;
        var modeSnapshot = JsonSerializer.Serialize(
            selectedModes.OrderBy(mode => mode).Select(mode => mode.ToString()));
        var message = new MessageRecord(
            Guid.NewGuid().ToString("N"), _selectedConversation.Id, provider,
            "user", text, "pending", DateTimeOffset.UtcNow, effectiveParent,
            ModeSnapshot: modeSnapshot,
            ModelSnapshot: selectedModel);
        _database.AddMessage(message);
        _pendingUserMessages[provider] = message.Id;
        var attachmentRecords = _attachments.Select(attachment => new AttachmentRecord(
            Guid.NewGuid().ToString("N"), message.Id, attachment.Path, attachment.Name,
            attachment.Kind, attachment.Size, "pending")).ToList();
        foreach (var attachment in attachmentRecords)
            _database.AddAttachment(attachment);
        _editParentId = null;
        ComposerBox.Clear();
        SetGenerating(true);
        RefreshMessages();

        try
        {
            if (_providerPreparation.Remove(provider, out var preparation))
                await preparation;
            var request = new ProviderSendRequest(
                text,
                attachmentRecords.Select(attachment => new OutgoingAttachment(
                    attachment.Id,
                    attachment.LocalPath,
                    attachment.Name,
                    attachment.Kind,
                    attachment.Size)).ToArray(),
                selectedModes.ToHashSet(),
                selectedModel);
            await _runtimes[provider].SendAsync(request);
            if (_pendingUserMessages.Remove(provider, out var acceptedUserId))
                _database.UpdateMessage(
                    acceptedUserId,
                    FindMessageText(acceptedUserId),
                    "completed");
            foreach (var attachment in attachmentRecords)
                _database.UpdateAttachment(attachment.Id, "uploaded");
            _attachments.Clear();
            RefreshAttachmentPanel();
        }
        catch (Exception exception)
        {
            _database.UpdateMessage(message.Id, text, "failed", exception.Message);
            foreach (var attachment in attachmentRecords)
                _database.UpdateAttachment(attachment.Id, "failed", exception.Message);
            _pendingUserMessages.Remove(provider);
            SetGenerating(false);
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
            if (message.Type == "capabilities.changed")
            {
                if (_currentProvider == provider) RefreshCapabilities();
                return;
            }
            if (message.Type == "message.dispatched")
            {
                if (_pendingUserMessages.Remove(provider, out var userId))
                    _database.UpdateMessage(userId, FindMessageText(userId), "completed");
                EnsureStreamingMessage(provider);
                SetGenerating(true);
            }
            else if (message.Type == "message.started")
            {
                if (_pendingUserMessages.Remove(provider, out var userId))
                    _database.UpdateMessage(userId, FindMessageText(userId), "completed");
                EnsureStreamingMessage(provider);
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
                if (!string.IsNullOrWhiteSpace(message.Html))
                    snapshot.Html = message.Html;
                snapshot.LastChunkAt = DateTime.UtcNow;
                QueueStreamingRender(provider, snapshot);
            }
            else if (message.Type == "message.completed" &&
                     _streamingMessages.Remove(provider, out var completed))
            {
                var finalText = TextEncodingRepair.Normalize(
                    message.Text ?? completed.RawText);
                _database.UpdateMessage(
                    completed.Id,
                    finalText,
                    "completed",
                    html: message.Html ?? completed.Html);
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

    private void EnsureStreamingMessage(ProviderId provider)
    {
        if (_streamingMessages.ContainsKey(provider) ||
            _selectedConversation?.Provider != provider) return;
        var id = Guid.NewGuid().ToString("N");
        _streamingMessages[provider] = new StreamingMessageState(id);
        _database.AddMessage(new MessageRecord(
            id,
            _selectedConversation.Id,
            provider,
            "assistant",
            "",
            "streaming",
            DateTimeOffset.UtcNow));
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
                    _database.UpdateMessage(
                        current.Id,
                        next,
                        "streaming",
                        html: current.Html);
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
        if (_selectedConversation is null) return;
        var definition = ProviderCatalog.Get(_selectedConversation.Provider);
        var isLight = ThemeService.IsLightTheme();
        var messages = _database.GetMessages(_selectedConversation.Id);
        var attachments = messages.ToDictionary(
            message => message.Id,
            message => _database.GetAttachments(message.Id));
        _ = _messageView.RenderMessagesAsync(
            messages,
            definition,
            isLight,
            attachments);
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

    private void MessageView_OnAction(object? sender, MessageActionEventArgs args)
    {
        Dispatcher.Invoke(async () =>
        {
            if (_selectedConversation is null) return;
            var messages = _database.GetMessages(_selectedConversation.Id).ToList();
            var target = messages.FirstOrDefault(m => m.Id == args.MessageId);
            if (target is null) return;

            if (args.Type == "copy")
            {
                try
                {
                    Clipboard.SetDataObject(target.Text, true);
                    ShowToast("已复制");
                }
                catch { ShowToast("复制失败"); }
            }
            else if (args.Type == "retry" && target.Role == "assistant")
            {
                var user = messages.Take(messages.IndexOf(target))
                    .LastOrDefault(m => m.Role == "user");
                if (user is not null) await SendCurrentMessageAsync(user.Text, user.Id);
            }
            else if (args.Type == "edit")
            {
                ComposerBox.Text = target.Text;
                _editParentId = target.Id;
                ComposerBox.Focus();
                ComposerBox.CaretIndex = ComposerBox.Text.Length;
                ShowToast("已进入编辑重发模式");
            }
        });
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
            ProviderWebDrawer.Visibility = Visibility.Visible;
            DrawerTitle.Text = $"{ProviderCatalog.Get(provider).Label} 官网";
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

    private void ComposerBox_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.V ||
            !Keyboard.Modifiers.HasFlag(ModifierKeys.Control) ||
            !Clipboard.ContainsImage()) return;
        var image = Clipboard.GetImage();
        if (image is null) return;
        var draftRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AIHub.Native",
            "draft-attachments");
        Directory.CreateDirectory(draftRoot);
        var path = Path.Combine(
            draftRoot,
            $"clipboard-{DateTimeOffset.Now:yyyyMMdd-HHmmss-fff}.png");
        using (var stream = File.Create(path))
        {
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(image));
            encoder.Save(stream);
        }
        AddAttachmentPaths([path]);
        e.Handled = true;
    }

    private void ComposerBox_OnPreviewDragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop)
            ? DragDropEffects.Copy
            : DragDropEffects.None;
        e.Handled = true;
    }

    private void ComposerBox_OnDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is string[] paths)
            AddAttachmentPaths(paths);
        e.Handled = true;
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

    private void RefreshCapabilities()
    {
        CapabilityBar.Items.Clear();
        _modeButtons.Clear();
        var runtimeCapabilities = _runtimes[_currentProvider].Capabilities;
        var fallback = ProviderCatalog.Get(_currentProvider).Capabilities;
        var attachments = runtimeCapabilities.Attachments.Count > 0
            ? runtimeCapabilities.Attachments
            : fallback.Attachments;
        AttachButton.Visibility = attachments.Count > 0
            ? Visibility.Visible : Visibility.Collapsed;
        RefreshModelSelector(runtimeCapabilities);
        IEnumerable<ProviderModeState> availableModes = runtimeCapabilities.Modes.Count > 0
            ? runtimeCapabilities.Modes
            : fallback.Modes.Select(mode =>
                new ProviderModeState(mode, ModeLabel(mode), false));
        var availableModeList = availableModes.ToList();
        var selectedModes = SelectedModes(_currentProvider);
        selectedModes.RemoveWhere(mode =>
            availableModeList.All(item => item.Mode != mode));
        var initializeSelection =
            _modeSelectionsInitialized.Add(_currentProvider);
        foreach (var mode in availableModeList)
        {
            if (initializeSelection && mode.Enabled) selectedModes.Add(mode.Mode);
            var toggle = new ToggleButton
            {
                Content = mode.Label,
                Tag = mode.Mode,
                IsChecked = selectedModes.Contains(mode.Mode),
                Margin = new Thickness(4, 0, 0, 0),
            };
            toggle.Click += ModeToggle_OnClick;
            _modeButtons[mode.Mode] = toggle;
            CapabilityBar.Items.Add(toggle);
        }
    }

    private void RefreshModelSelector(ProviderCapabilitySnapshot capabilities)
    {
        var models = capabilities.Models ?? [];
        var current = _selectedModels.GetValueOrDefault(_currentProvider) ??
            capabilities.Model;
        if (models.Count == 0 && string.IsNullOrWhiteSpace(current))
        {
            ModelSelector.Visibility = Visibility.Collapsed;
            return;
        }
        _updatingModelSelector = true;
        try
        {
            ModelSelector.ItemsSource = models.Count > 0
                ? models
                : [new ProviderModelState(current!, current!)];
            ModelSelector.DisplayMemberPath = nameof(ProviderModelState.Label);
            ModelSelector.SelectedValuePath = nameof(ProviderModelState.Id);
            ModelSelector.SelectedValue = current;
            ModelSelector.Visibility = Visibility.Visible;
        }
        finally
        {
            _updatingModelSelector = false;
        }
    }

    private async void ModelSelector_OnDropDownOpened(
        object sender,
        EventArgs e)
    {
        try
        {
            await _runtimes[_currentProvider].DiscoverModelsAsync();
            RefreshCapabilities();
        }
        catch (Exception exception)
        {
            ShowToast(exception.Message);
        }
    }

    private void ModelSelector_OnSelectionChanged(
        object sender,
        SelectionChangedEventArgs e)
    {
        if (_updatingModelSelector ||
            ModelSelector.SelectedValue is not string model ||
            string.IsNullOrWhiteSpace(model)) return;
        _selectedModels[_currentProvider] = model;
    }

    private void ModeToggle_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not ToggleButton { Tag: ProviderMode mode } toggle) return;
        var selectedModes = SelectedModes(_currentProvider);
        if (toggle.IsChecked == true) selectedModes.Add(mode);
        else selectedModes.Remove(mode);
    }

    private HashSet<ProviderMode> SelectedModes(ProviderId provider)
    {
        if (_selectedModes.TryGetValue(provider, out var selected)) return selected;
        selected = [];
        _selectedModes[provider] = selected;
        return selected;
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
        IReadOnlySet<AttachmentKind> capabilities =
            _runtimes[_currentProvider].Capabilities.Attachments;
        if (capabilities.Count == 0)
            capabilities = ProviderCatalog.Get(_currentProvider).Capabilities.Attachments;
        if (capabilities.Count == 0) return;
        var dialog = new OpenFileDialog
        {
            Multiselect = _runtimes[_currentProvider].Capabilities.Attachments.Count == 0 ||
                _runtimes[_currentProvider].Capabilities.MultipleAttachments,
            Filter = "支持的文件|*.png;*.jpg;*.jpeg;*.webp;*.pdf;*.doc;*.docx;*.xls;*.xlsx;*.ppt;*.pptx;*.txt;*.md",
        };
        if (dialog.ShowDialog(this) != true) return;
        AddAttachmentPaths(dialog.FileNames);
    }

    private void AddAttachmentPaths(IEnumerable<string> paths)
    {
        IReadOnlySet<AttachmentKind> capabilities =
            _runtimes[_currentProvider].Capabilities.Attachments;
        if (capabilities.Count == 0)
            capabilities = ProviderCatalog.Get(_currentProvider).Capabilities.Attachments;
        var allowsMultiple =
            _runtimes[_currentProvider].Capabilities.Attachments.Count == 0 ||
            _runtimes[_currentProvider].Capabilities.MultipleAttachments;
        foreach (var path in paths)
        {
            if (!File.Exists(path)) continue;
            var file = new FileInfo(path);
            var kind = AttachmentType.FromPath(path);
            if (kind is null || !capabilities.Contains(kind.Value))
            {
                ShowToast($"{file.Name} 不受当前模型支持。");
                continue;
            }
            if (!allowsMultiple && _attachments.Count > 0)
            {
                ShowToast("当前官网只允许选择一个附件。");
                break;
            }
            if (_attachments.Any(item =>
                    string.Equals(item.Path, path, StringComparison.OrdinalIgnoreCase)))
                continue;
            _attachments.Add(new AttachmentDraft(
                path,
                file.Name,
                kind.Value,
                file.Length));
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

    private sealed class StreamingMessageState(string id)
    {
        public string Id { get; } = id;
        public string RawText { get; set; } = "";
        public string DisplayText { get; set; } = "";
        public string? Html { get; set; }
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
