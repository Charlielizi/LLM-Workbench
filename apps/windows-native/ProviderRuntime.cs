using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AIHub.Windows;

public sealed class ProviderRuntime : IDisposable
{
    private const int MaxResponseBytes = 8 * 1024 * 1024;
    private readonly Grid _host;
    private readonly string _profileRoot;
    private readonly string _diagnosticsRoot;
    private bool _initialized;
    private bool _bridgeReady;
    private TaskCompletionSource<bool> _navigationReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _awaitingDoubaoBrief;
    private string? _doubaoMessageId;
    private string? _lastSentText;
    private string? _lastBrief;
    private string? _pendingDoubaoBrief;
    private string _doubaoStreamText = "";
    private CancellationTokenSource? _doubaoCompletion;
    private CancellationTokenSource? _doubaoDiagnostics;
    private readonly List<ResponseTextCandidate> _doubaoCandidates = [];

    public ProviderDefinition Definition { get; }
    public WebView2 View { get; }
    public bool IsAuthenticated { get; private set; }

    public event EventHandler<ProviderBridgeEvent>? BridgeEvent;

    public ProviderRuntime(ProviderDefinition definition, Grid host, string profileRoot)
    {
        Definition = definition;
        _host = host;
        _profileRoot = profileRoot;
        _diagnosticsRoot = Path.Combine(
            Directory.GetParent(profileRoot)?.FullName ?? profileRoot,
            "diagnostics");
        View = new WebView2
        {
            Visibility = Visibility.Collapsed,
            DefaultBackgroundColor = System.Drawing.Color.White,
        };
        Panel.SetZIndex(View, 20);
        _host.Children.Add(View);
    }

    public async Task EnsureInitializedAsync()
    {
        if (_initialized) return;
        var profilePath = Path.Combine(_profileRoot, Definition.Id.ToString().ToLowerInvariant());
        Directory.CreateDirectory(profilePath);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profilePath);
        await View.EnsureCoreWebView2Async(environment);

        View.CoreWebView2.Settings.AreDevToolsEnabled = false;
        View.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        View.CoreWebView2.Settings.IsPasswordAutosaveEnabled = true;
        View.CoreWebView2.Settings.IsGeneralAutofillEnabled = true;
        View.CoreWebView2.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        View.CoreWebView2.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (IsAllowed(args.Uri))
            {
                View.CoreWebView2.Navigate(args.Uri);
                return;
            }
            _ = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(args.Uri)
            {
                UseShellExecute = true,
            });
        };
        View.CoreWebView2.NavigationStarting += (_, args) =>
        {
            _bridgeReady = false;
            _navigationReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!IsAllowed(args.Uri))
            {
                args.Cancel = true;
                _ = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(args.Uri)
                {
                    UseShellExecute = true,
                });
            }
        };
        View.CoreWebView2.NavigationCompleted += (_, args) =>
            _navigationReady.TrySetResult(args.IsSuccess);
        View.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        if (Definition.Id == ProviderId.Doubao)
        {
            View.CoreWebView2.WebResourceResponseReceived += OnWebResourceResponseReceived;
        }
        await View.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            ProviderBridgeScript.Build(Definition));
        View.Source = new Uri(Definition.LoginUrl);
        _initialized = true;
    }

    public async Task ShowAsync()
    {
        await EnsureInitializedAsync();
        foreach (var sibling in _host.Children.OfType<WebView2>())
            sibling.Visibility = Visibility.Collapsed;
        View.Visibility = Visibility.Visible;
        View.Focus();
    }

    public void Hide() => View.Visibility = Visibility.Collapsed;

    public async Task StartNewConversationAsync()
    {
        await EnsureInitializedAsync();
        View.CoreWebView2.Navigate(Definition.LoginUrl);
        await WaitForNavigationAsync();
    }

    public async Task SendAsync(string text)
    {
        await EnsureInitializedAsync();
        await WaitForBridgeAsync();
        if (Definition.Id == ProviderId.Doubao)
        {
            _awaitingDoubaoBrief = true;
            _lastSentText = text.Trim();
            _doubaoMessageId = Guid.NewGuid().ToString("N");
            _pendingDoubaoBrief = null;
            _doubaoStreamText = "";
            _doubaoCompletion?.Cancel();
            _doubaoDiagnostics?.Cancel();
            _doubaoCandidates.Clear();
            BridgeEvent?.Invoke(this, new("message.started", _doubaoMessageId));
        }
        View.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "send",
            text,
        }));
    }

    public async Task UploadAttachmentsAsync(IReadOnlyList<string> paths)
    {
        await EnsureInitializedAsync();
        if (paths.Count == 0) return;
        if (Definition.FileInputSelectors.Length == 0)
            throw new InvalidOperationException($"{Definition.Label} 的附件能力尚未验证。");

        var documentJson = await View.CoreWebView2.CallDevToolsProtocolMethodAsync(
            "DOM.getDocument", """{"depth":-1,"pierce":true}""");
        using var document = JsonDocument.Parse(documentJson);
        var rootNodeId = document.RootElement.GetProperty("root").GetProperty("nodeId").GetInt32();
        int nodeId = 0;
        foreach (var selector in Definition.FileInputSelectors)
        {
            var query = JsonSerializer.Serialize(new { nodeId = rootNodeId, selector });
            var resultJson = await View.CoreWebView2.CallDevToolsProtocolMethodAsync(
                "DOM.querySelector", query);
            using var result = JsonDocument.Parse(resultJson);
            nodeId = result.RootElement.GetProperty("nodeId").GetInt32();
            if (nodeId != 0) break;
        }
        if (nodeId == 0)
            throw new InvalidOperationException(
                $"{Definition.Label} 官网的附件入口未找到，该能力已停止执行。");

        var parameters = JsonSerializer.Serialize(new { nodeId, files = paths });
        await View.CoreWebView2.CallDevToolsProtocolMethodAsync(
            "DOM.setFileInputFiles", parameters);
    }

    public async Task<AdapterAuditReport> RunAuditAsync(
        string prompt,
        TimeSpan timeout)
    {
        await ShowAsync();
        await WaitForBridgeAsync();

        var completion = new TaskCompletionSource<ProviderBridgeEvent>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? _, ProviderBridgeEvent message)
        {
            if (message.Type is "message.completed" or "generation.failed" or
                "command.failed" or "adapter.degraded")
                completion.TrySetResult(message);
        }

        BridgeEvent += Handler;
        ProviderBridgeEvent? finalEvent = null;
        string status;
        string? error = null;
        try
        {
            await SendAsync(prompt);
            var finished = await Task.WhenAny(completion.Task, Task.Delay(timeout));
            if (finished == completion.Task)
            {
                finalEvent = await completion.Task;
                status = finalEvent.Type;
                error = finalEvent.Reason;
            }
            else
            {
                status = "timeout";
                error = "Timed out while waiting for the provider response.";
            }
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
        catch (Exception exception)
        {
            status = "exception";
            error = exception.Message;
        }
        finally
        {
            BridgeEvent -= Handler;
        }

        var candidates = await CaptureAuditCandidatesAsync(prompt);
        var host = Uri.TryCreate(View.Source?.AbsoluteUri, UriKind.Absolute, out var uri)
            ? uri.Host
            : "";
        return new AdapterAuditReport(
            Definition.Id,
            host,
            IsAuthenticated,
            status,
            finalEvent?.Text,
            error,
            candidates,
            DateTimeOffset.UtcNow);
    }

    private async Task<IReadOnlyList<AdapterAuditCandidate>> CaptureAuditCandidatesAsync(
        string prompt)
    {
        var promptJson = JsonSerializer.Serialize(prompt);
        var script = $$"""
            (() => {
              const prompt = {{promptJson}};
              const normalize = value => (value || "")
                .replace(/\r/g, "")
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
              const visible = element => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== "none" && style.visibility !== "hidden" &&
                  rect.width > 2 && rect.height > 2;
              };
              const stableSelector = element => {
                for (const name of ["data-testid", "data-role", "data-message-role", "role"]) {
                  const value = element.getAttribute(name);
                  if (value && value.length < 80)
                    return `${element.tagName.toLowerCase()}[${name}="${CSS.escape(value)}"]`;
                }
                const tokens = [...element.classList]
                  .filter(value => value.length > 2 && value.length < 48)
                  .filter(value => !/^[a-f0-9_-]{10,}$/i.test(value))
                  .slice(0, 3);
                return element.tagName.toLowerCase() +
                  tokens.map(value => "." + CSS.escape(value)).join("");
              };
              const boilerplate = /^(Copy|Retry|Edit|Share|Download|Stop|Send|\u590d\u5236|\u91cd\u8bd5|\u7f16\u8f91|\u5206\u4eab|\u4e0b\u8f7d|\u505c\u6b62|\u53d1\u9001)$/i;
              const roots = [document];
              const visit = root => root.querySelectorAll("*").forEach(node => {
                if (node.shadowRoot) {
                  roots.push(node.shadowRoot);
                  visit(node.shadowRoot);
                }
              });
              visit(document);
              const values = [];
              const seen = new Set();
              const elements = [];
              for (const root of roots)
                elements.push(...root.querySelectorAll(
                  "article,p,div,button,textarea,input,[contenteditable],[role=button]," +
                  "[data-testid],[data-role],[data-message-role]"
                ));
              for (const element of elements) {
                if (!visible(element)) continue;
                let text = normalize(element.innerText || element.textContent);
                const control = element.matches(
                  "button,textarea,input,[contenteditable='true'],[role='textbox'],[role='button']");
                if (control) {
                  text = `[${element.tagName.toUpperCase()}] ` + [
                    normalize(element.innerText || element.textContent),
                    element.value,
                    element.getAttribute("placeholder"),
                    element.getAttribute("aria-label"),
                    element.getAttribute("title"),
                    element.getAttribute("data-testid"),
                    element.getAttribute("role"),
                    element.disabled ? "disabled" : "enabled"
                  ].filter(Boolean).join(" | ");
                }
                if (!text || text === prompt || text.length > 12000)
                  continue;
                if (!control && text.length < 8) continue;
                text = text.split("\n")
                  .map(line => line.trim())
                  .filter(line => line && !boilerplate.test(line))
                  .join("\n").trim();
                if (!text || text === prompt || seen.has(text)) continue;
                seen.add(text);
                const afterPrompt = document.body.innerText.indexOf(prompt) >= 0 &&
                  (element.compareDocumentPosition(
                    [...document.querySelectorAll("*")].find(node =>
                      normalize(node.textContent) === prompt) || document.body
                  ) & Node.DOCUMENT_POSITION_PRECEDING);
                const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
                const markdown = /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|```|>)/.test(text);
                let score = text.length + cjk * 2 + (markdown ? 100 : 0);
                if (control) score += 1000;
                if (afterPrompt) score += 200;
                if (/assistant|answer|markdown|message-content/i.test(
                    `${element.className} ${element.getAttribute("data-role") || ""}`))
                  score += 180;
                values.push({
                  selector: stableSelector(element),
                  tag: element.tagName.toLowerCase(),
                  text: text.slice(0, 2000),
                  score
                });
              }
              return values.sort((a, b) => b.score - a.score).slice(0, 80);
            })()
            """;
        try
        {
            var encoded = await View.CoreWebView2.ExecuteScriptAsync(script);
            return JsonSerializer.Deserialize<List<AdapterAuditCandidate>>(
                encoded,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        }
        catch
        {
            return [];
        }
    }

    public void Cancel()
    {
        _awaitingDoubaoBrief = false;
        _doubaoCompletion?.Cancel();
        if (_initialized)
            View.CoreWebView2.PostWebMessageAsJson("""{"type":"cancel"}""");
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var message = JsonSerializer.Deserialize<ProviderBridgeEvent>(
                args.WebMessageAsJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (message is null) return;
            if (message.Type == "auth.changed" && message.Authenticated is bool authenticated)
                IsAuthenticated = authenticated;
            if (message.Type == "bridge.ready")
                _bridgeReady = true;
            if (message.Type == "send.activation.required" &&
                message.X is double x && message.Y is double y)
            {
                _ = DispatchTrustedClickAsync(x, y);
                return;
            }
            if (Definition.Id == ProviderId.Doubao &&
                message.Type is "message.started" or "message.delta" or
                    "message.snapshot" or "message.completed")
            {
                return;
            }
            if (message.Type is "command.failed" or "generation.failed")
            {
                _awaitingDoubaoBrief = false;
                _doubaoCompletion?.Cancel();
            }
            BridgeEvent?.Invoke(this, message);
        }
        catch
        {
            BridgeEvent?.Invoke(this, new("adapter.degraded", Reason: "Invalid website bridge event."));
        }
    }

    private async void OnWebResourceResponseReceived(
        object? sender,
        CoreWebView2WebResourceResponseReceivedEventArgs args)
    {
        if (!_awaitingDoubaoBrief || args.Response.StatusCode is < 200 or >= 300)
            return;
        try
        {
            await using var content = await args.Response.GetContentAsync();
            if (content is null || !content.CanRead) return;
            using var buffer = new MemoryStream();
            var chunk = new byte[32 * 1024];
            while (buffer.Length <= MaxResponseBytes)
            {
                var read = await content.ReadAsync(chunk);
                if (read == 0) break;
                await buffer.WriteAsync(chunk.AsMemory(0, read));
            }
            if (buffer.Length == 0 || buffer.Length > MaxResponseBytes) return;

            var payload = System.Text.Encoding.UTF8.GetString(buffer.ToArray());
            _doubaoCandidates.AddRange(
                DoubaoResponseInspector.ExtractCandidates(payload));
            ScheduleDiagnosticSnapshot();

            var streamChunks = DoubaoStreamExtractor.Extract(payload)
                .Where(chunk =>
                    !string.Equals(chunk.Text, _lastSentText, StringComparison.Ordinal))
                .ToList();
            if (streamChunks.Count > 0)
            {
                foreach (var streamChunk in streamChunks)
                    AppendDoubaoChunk(streamChunk.Text);
                ScheduleDoubaoCompletion();
                return;
            }

            // Brief is metadata on some response types. Keep it only as a
            // delayed fallback when no assistant text stream was captured.
            var brief = DoubaoBriefExtractor.Extract(payload)
                .Where(value =>
                    !string.Equals(value, _lastSentText, StringComparison.Ordinal) &&
                    !string.Equals(value, _lastBrief, StringComparison.Ordinal))
                .OrderByDescending(CandidateScore)
                .FirstOrDefault();
            if (string.IsNullOrWhiteSpace(brief)) return;

            if (_pendingDoubaoBrief is null ||
                CandidateScore(brief) >= CandidateScore(_pendingDoubaoBrief))
            {
                _pendingDoubaoBrief = brief;
            }
            ScheduleDoubaoCompletion();
        }
        catch
        {
            // Not every web resource exposes a readable response body.
        }
    }

    private void ScheduleDiagnosticSnapshot()
    {
        _doubaoDiagnostics?.Cancel();
        var cancellation = _doubaoDiagnostics = new CancellationTokenSource();
        _ = WriteDiagnosticSnapshotAfterQuietPeriodAsync(cancellation.Token);
    }

    private async Task WriteDiagnosticSnapshotAfterQuietPeriodAsync(
        CancellationToken cancellation)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(3), cancellation);
            var script = """
                (() => {
                  const root = document.querySelector('main') || document.body;
                  return (root?.innerText || root?.textContent || '').trim();
                })()
                """;
            var encoded = await View.CoreWebView2.ExecuteScriptAsync(script);
            var visibleText = JsonSerializer.Deserialize<string>(encoded) ?? "";
            await DoubaoResponseInspector.WriteSnapshotAsync(
                _diagnosticsRoot,
                _doubaoCandidates,
                TextEncodingRepair.Normalize(visibleText));
        }
        catch (OperationCanceledException)
        {
            // New response traffic restarted the diagnostic quiet period.
        }
        catch
        {
            // Diagnostics must never interfere with normal provider operation.
        }
    }

    private void ScheduleDoubaoCompletion()
    {
        _doubaoCompletion?.Cancel();
        var cancellation = _doubaoCompletion = new CancellationTokenSource();
        _ = CompleteDoubaoAfterQuietPeriodAsync(cancellation.Token);
    }

    private async Task CompleteDoubaoAfterQuietPeriodAsync(CancellationToken cancellation)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(1600), cancellation);
            var finalText = !string.IsNullOrWhiteSpace(_doubaoStreamText)
                ? _doubaoStreamText
                : _pendingDoubaoBrief;
            if (!_awaitingDoubaoBrief || string.IsNullOrWhiteSpace(finalText)) return;

            _awaitingDoubaoBrief = false;
            _lastBrief = finalText;
            _pendingDoubaoBrief = null;
            var messageId = _doubaoMessageId ?? Guid.NewGuid().ToString("N");
            BridgeEvent?.Invoke(this, new("message.delta", messageId, finalText));
            BridgeEvent?.Invoke(this, new("message.completed", messageId, finalText));
        }
        catch (OperationCanceledException)
        {
            // A newer response fragment restarted the quiet-period timer.
        }
    }

    private void AppendDoubaoChunk(string chunk)
    {
        var normalized = TextEncodingRepair.Normalize(chunk);
        if (string.IsNullOrWhiteSpace(normalized)) return;
        if (normalized == _doubaoStreamText ||
            _doubaoStreamText.EndsWith(normalized, StringComparison.Ordinal))
            return;
        if (normalized.StartsWith(_doubaoStreamText, StringComparison.Ordinal))
            _doubaoStreamText = normalized;
        else
            _doubaoStreamText += normalized;
    }

    private static int CandidateScore(string value)
    {
        var cjk = value.Count(character => character is >= '\u3400' and <= '\u9fff');
        return value.Length + cjk * 4;
    }

    private bool IsAllowed(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed)) return false;
        if (parsed.Scheme is not ("https" or "http")) return false;
        return Definition.AllowedOrigins.Any(value =>
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var allowed)) return false;
            return parsed.Host.Equals(allowed.Host, StringComparison.OrdinalIgnoreCase) ||
                   parsed.Host.EndsWith("." + allowed.Host, StringComparison.OrdinalIgnoreCase);
        });
    }

    private async Task WaitForNavigationAsync()
    {
        if (View.CoreWebView2.Source is null) return;
        var completed = await Task.WhenAny(
            _navigationReady.Task,
            Task.Delay(TimeSpan.FromSeconds(20)));
        if (completed != _navigationReady.Task || !await _navigationReady.Task)
            throw new InvalidOperationException(
                $"{Definition.Label} 官网加载失败，请打开官网面板检查网络或验证页面。");
    }

    private async Task WaitForBridgeAsync()
    {
        for (var attempt = 0; attempt < 40; attempt++)
        {
            if (_bridgeReady) return;
            View.CoreWebView2.PostWebMessageAsJson("""{"type":"probe"}""");
            await Task.Delay(250);
        }
        throw new InvalidOperationException(
            $"{Definition.Label} 网页桥接尚未就绪，请打开官网面板后重试。");
    }

    private async Task DispatchTrustedClickAsync(double x, double y)
    {
        try
        {
            foreach (var type in new[] { "mousePressed", "mouseReleased" })
            {
                var payload = JsonSerializer.Serialize(new
                {
                    type,
                    x,
                    y,
                    button = "left",
                    buttons = type == "mousePressed" ? 1 : 0,
                    clickCount = 1,
                });
                await View.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Input.dispatchMouseEvent", payload);
            }
        }
        catch (Exception exception)
        {
            BridgeEvent?.Invoke(this, new(
                "command.failed",
                Reason: $"Trusted send activation failed: {exception.Message}"));
        }
    }

    public void Dispose()
    {
        _doubaoCompletion?.Cancel();
        _doubaoCompletion?.Dispose();
        _doubaoDiagnostics?.Cancel();
        _doubaoDiagnostics?.Dispose();
        View.Dispose();
    }
}
