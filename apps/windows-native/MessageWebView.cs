using System.Diagnostics;
using System.Text.Json;
using Markdig;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AIHub.Windows;

public sealed class MessageWebView : IDisposable
{
    private readonly WebView2 _view;
    private readonly SemaphoreSlim _initializationLock = new(1, 1);
    private readonly SemaphoreSlim _renderLock = new(1, 1);
    private readonly Dictionary<string, RenderedMarkdownCache> _markdownCache = [];
    private bool _initialized;
    private long _renderVersion;
    private static readonly MarkdownPipeline MarkdownPipeline =
        new MarkdownPipelineBuilder().UseAdvancedExtensions().UseMathematics().Build();

    public WebView2 View => _view;
    public event EventHandler<MessageActionEventArgs>? Action;

    public MessageWebView()
    {
        _view = new WebView2
        {
            DefaultBackgroundColor = System.Drawing.Color.FromArgb(243, 245, 248),
        };
    }

    public async Task RenderMessagesAsync(
        IReadOnlyList<MessageRecord> messages,
        ProviderDefinition definition,
        bool isLightTheme,
        IReadOnlyDictionary<string, IReadOnlyList<AttachmentRecord>>? attachments = null)
    {
        await EnsureInitializedAsync();
        var incomingIds = messages.Select(message => message.Id).ToHashSet();
        foreach (var staleId in _markdownCache.Keys
                     .Where(id => !incomingIds.Contains(id))
                     .ToArray())
            _markdownCache.Remove(staleId);
        var payload = new MessagePagePayload(
            definition.Label,
            isLightTheme,
            messages.Select(message => new MessagePageItem(
                message.Id,
                message.Role,
                TextEncodingRepair.Normalize(message.Text),
                RenderMarkdown(message),
                message.Html,
                message.Status,
                TextEncodingRepair.Normalize(message.ErrorCode ?? ""),
                ModeLabels(message.ModeSnapshot),
                message.ModelSnapshot,
                attachments?.GetValueOrDefault(message.Id)
                    ?.Select(item => item.Name)
                    .ToArray() ?? [])).ToArray());
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var version = Interlocked.Increment(ref _renderVersion);
        await ExecuteRenderAsync(json, version);
    }

    public async Task ClearAsync(bool isLightTheme)
    {
        await EnsureInitializedAsync();
        var payload = JsonSerializer.Serialize(
            new MessagePagePayload("", isLightTheme, []),
            JsonOptions);
        _markdownCache.Clear();
        var version = Interlocked.Increment(ref _renderVersion);
        await ExecuteRenderAsync(payload, version);
    }

    private string RenderMarkdown(MessageRecord message)
    {
        var text = TextEncodingRepair.Normalize(message.Text);
        if (_markdownCache.TryGetValue(message.Id, out var cached) &&
            cached.Text == text)
            return cached.Html;
        var html = Markdown.ToHtml(text, MarkdownPipeline);
        _markdownCache[message.Id] = new(text, html);
        return html;
    }

    private static string[] ModeLabels(string? snapshot)
    {
        if (string.IsNullOrWhiteSpace(snapshot)) return [];
        try
        {
            return (JsonSerializer.Deserialize<string[]>(snapshot) ?? [])
                .Select(value => Enum.TryParse<ProviderMode>(value, out var mode)
                    ? mode switch
                    {
                        ProviderMode.WebSearch => "联网搜索",
                        ProviderMode.Reasoning => "深度思考",
                        ProviderMode.ImageUnderstanding => "图片理解",
                        ProviderMode.ImageGeneration => "图片生成",
                        ProviderMode.Coding => "编程",
                        _ => "文档",
                    }
                    : value)
                .ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task ExecuteRenderAsync(string payload, long version)
    {
        await _renderLock.WaitAsync();
        try
        {
            if (version != Volatile.Read(ref _renderVersion)) return;
            await _view.CoreWebView2.ExecuteScriptAsync(
                $"window.aihub.render({payload})");
        }
        finally
        {
            _renderLock.Release();
        }
    }

    private async Task EnsureInitializedAsync()
    {
        if (_initialized) return;
        await _initializationLock.WaitAsync();
        try
        {
            if (_initialized) return;
            await _view.EnsureCoreWebView2Async();
            var assetRoot = Path.Combine(AppContext.BaseDirectory, "Assets");
            _view.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "aihub.local",
                assetRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            _view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _view.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _view.CoreWebView2.NavigationStarting += OnNavigationStarting;
            _view.CoreWebView2.NewWindowRequested += OnNewWindowRequested;

            var ready = new TaskCompletionSource(
                TaskCreationOptions.RunContinuationsAsynchronously);
            void NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                _view.CoreWebView2.NavigationCompleted -= NavigationCompleted;
                if (args.IsSuccess) ready.TrySetResult();
                else ready.TrySetException(new InvalidOperationException(
                    $"消息视图初始化失败：{args.WebErrorStatus}"));
            }

            _view.CoreWebView2.NavigationCompleted += NavigationCompleted;
            var katexCssPath = Path.Combine(
                AppContext.BaseDirectory,
                "Assets",
                "katex",
                "katex.min.css");
            var katexCss = await File.ReadAllTextAsync(katexCssPath);
            _view.NavigateToString(HtmlTemplate.Replace(
                "/*__KATEX_CSS__*/",
                RewriteKatexFontUrls(katexCss),
                StringComparison.Ordinal));
            await ready.Task;
            _initialized = true;
        }
        finally
        {
            _initializationLock.Release();
        }
    }

    private static string RewriteKatexFontUrls(string css) =>
        css.Replace(
            "url(fonts/",
            "url(https://aihub.local/katex/fonts/",
            StringComparison.Ordinal);

    private void OnWebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var message = JsonSerializer.Deserialize<MessageActionPayload>(
                args.WebMessageAsJson,
                JsonOptions);
            if (message is null ||
                string.IsNullOrWhiteSpace(message.Type) ||
                string.IsNullOrWhiteSpace(message.Id)) return;
            Action?.Invoke(this, new(message.Type, message.Id));
        }
        catch (JsonException)
        {
        }
    }

    private void OnNavigationStarting(
        object? sender,
        CoreWebView2NavigationStartingEventArgs args)
    {
        if (args.Uri.StartsWith("data:text/html", StringComparison.OrdinalIgnoreCase) ||
            args.Uri == "about:blank") return;
        args.Cancel = true;
        OpenExternal(args.Uri);
    }

    private static void OnNewWindowRequested(
        object? sender,
        CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        OpenExternal(args.Uri);
    }

    private static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) ||
            parsed.Scheme is not ("http" or "https")) return;
        Process.Start(new ProcessStartInfo(parsed.AbsoluteUri)
        {
            UseShellExecute = true,
        });
    }

    public void Dispose()
    {
        _initializationLock.Dispose();
        _renderLock.Dispose();
        _view.Dispose();
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private sealed record MessagePagePayload(
        string ProviderLabel,
        bool IsLightTheme,
        IReadOnlyList<MessagePageItem> Messages);

    private sealed record MessagePageItem(
        string Id,
        string Role,
        string Text,
        string RenderedTextHtml,
        string? Html,
        string Status,
        string ErrorCode,
        string[] ModeLabels,
        string? ModelSnapshot,
        string[] AttachmentNames);

    private sealed record MessageActionPayload(string Type, string Id);
    private sealed record RenderedMarkdownCache(string Text, string Html);

    private const string HtmlTemplate = """
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="color-scheme" content="light dark">
      <script src="https://aihub.local/katex/katex.min.js"></script>
      <style>
        /*__KATEX_CSS__*/
        :root {
          --page:#f3f5f8; --text:#1a1d23; --muted:#6b7280; --border:#e5e7eb;
          --user:#dce7f8; --assistant:#fff; --code:#f0f2f5; --link:#2563eb;
        }
        :root.dark {
          --page:#0f1219; --text:#e4e7ed; --muted:#9ca3af; --border:#2d3140;
          --user:#273248; --assistant:#181c26; --code:#1a1e28; --link:#60a5fa;
        }
        * { box-sizing:border-box; }
        html, body { margin:0; min-height:100%; background:var(--page); color:var(--text); }
        body {
          padding:14px 24px 28px;
          font:15.5px/1.65 "Segoe UI Variable Text","Microsoft YaHei UI","Segoe UI",sans-serif;
          overflow-wrap:anywhere;
        }
        #messages { display:flex; flex-direction:column; gap:14px; }
        .message {
          width:min(780px, 92%); padding:15px 18px; border-radius:14px;
          background:var(--assistant);
        }
        .message.user { align-self:flex-end; background:var(--user); white-space:pre-wrap; }
        .message.assistant { align-self:flex-start; }
        .author { margin-bottom:6px; color:var(--muted); font-size:12px; font-weight:600; }
        .body > :first-child { margin-top:0 !important; }
        .body > :last-child { margin-bottom:0 !important; }
        .body p { margin:.4em 0; }
        .body h1,.body h2,.body h3,.body h4 { margin:.9em 0 .35em; line-height:1.3; }
        .body h1 { font-size:1.35em; } .body h2 { font-size:1.2em; }
        .body h3 { font-size:1.08em; }
        .body ul,.body ol { margin:.4em 0; padding-left:1.5em; }
        .body blockquote {
          margin:.6em 0; padding:.15em .8em; color:var(--muted);
          border-left:3px solid var(--border);
        }
        .body pre {
          overflow:auto; margin:.6em 0; padding:12px; border-radius:8px;
          background:var(--code); white-space:pre;
        }
        .body code { font:13px/1.5 "Cascadia Mono","Consolas",monospace; }
        .body :not(pre) > code { padding:1px 5px; border-radius:4px; background:var(--code); }
        .body table { width:100%; margin:.6em 0; border-collapse:collapse; font-size:14px; }
        .body th,.body td { padding:6px 10px; border:1px solid var(--border); text-align:left; }
        .body th { background:var(--code); }
        .body img { max-width:100%; height:auto; border-radius:6px; }
        .body a { color:var(--link); }
        .body .katex-mathml { display:none !important; }
        .body .aihub-provider-math {
          all:revert;
        }
        .body .aihub-provider-math,
        .body .aihub-provider-math * {
          max-width:none;
        }
        .body .katex-display {
          max-width:100%;
          overflow-x:auto;
          overflow-y:hidden;
        }
        .body .katex-display::-webkit-scrollbar {
          width:.4rem;
          height:.4rem;
        }
        .body .katex-display::-webkit-scrollbar-thumb {
          visibility:hidden;
        }
        .body .katex-display:hover::-webkit-scrollbar-thumb {
          visibility:visible;
        }
        .actions { display:flex; gap:6px; margin-top:9px; }
        .actions button {
          padding:3px 8px; border:1px solid var(--border); border-radius:5px;
          background:transparent; color:var(--muted); font-size:11px; cursor:pointer;
        }
        .actions button:hover { background:var(--code); color:var(--text); }
        .status { margin-top:5px; color:#e4a675; font-size:11px; }
        .meta { display:flex; gap:5px; flex-wrap:wrap; margin-top:7px; }
        .meta span {
          padding:2px 7px; border:1px solid var(--border); border-radius:999px;
          color:var(--muted); background:var(--code); font-size:11px;
        }
        .empty { margin-top:40px; color:var(--muted); text-align:center; }
      </style>
    </head>
    <body>
      <main id="messages"></main>
      <script>
        (() => {
          const root = document.getElementById("messages");
          const known = new Map();
          const dangerousTags = new Set([
            "SCRIPT","STYLE","IFRAME","OBJECT","EMBED","FORM","INPUT","TEXTAREA",
            "BUTTON","SELECT","OPTION","META","LINK","BASE"
          ]);

          const safeUrl = value => {
            try {
              const url = new URL(value, "about:blank");
              return ["http:","https:","data:"].includes(url.protocol) ? value : "";
            } catch { return ""; }
          };

          const mathPlaceholder = (tex, display) => {
            const placeholder = document.createElement(display ? "div" : "span");
            placeholder.className = "aihub-math";
            placeholder.dataset.tex = tex || "";
            placeholder.dataset.display = display ? "true" : "false";
            return placeholder;
          };

          const replaceFormulaContainers = root => {
            for (const container of [...root.querySelectorAll("mjx-container")]) {
              const annotation = container.querySelector(
                "annotation[encoding*='tex']");
              const tex = annotation?.textContent?.trim();
              if (!tex) continue;
              container.replaceWith(mathPlaceholder(
                tex, container.getAttribute("display") === "true"));
            }
            for (const container of [...root.querySelectorAll(".katex")]) {
              const annotation = container.querySelector(
                "annotation[encoding*='tex']");
              const tex = annotation?.textContent?.trim();
              if (!tex) {
                if (!container.classList.contains("aihub-provider-math")) {
                  const fallback = document.createElement("span");
                  fallback.className = "aihub-math-fallback";
                  fallback.textContent = container.textContent || "";
                  container.replaceWith(fallback);
                }
                continue;
              }
              const display = !!container.closest(".katex-display");
              const target = display ? container.closest(".katex-display") : container;
              target.replaceWith(mathPlaceholder(tex, display));
            }
            for (const math of [...root.querySelectorAll("math")]) {
              if (math.closest(".katex,mjx-container")) continue;
              const annotation = math.querySelector("annotation[encoding*='tex']");
              const tex = annotation?.textContent?.trim();
              if (!tex) continue;
              math.replaceWith(mathPlaceholder(
                tex, math.getAttribute("display") === "block"));
            }
          };

          const renderMath = async root => {
            for (let attempt = 0; attempt < 40 && !window.katex; attempt++)
              await new Promise(resolve => setTimeout(resolve, 50));
            if (!window.katex) return;
            if (document.fonts?.ready) await document.fonts.ready;
            for (const element of root.querySelectorAll(".aihub-math")) {
              try {
                katex.render(element.dataset.tex || "", element, {
                  displayMode: element.dataset.display === "true",
                  throwOnError: false,
                  strict: "ignore",
                  trust: false
                });
              } catch {
                element.textContent = element.dataset.tex || "";
              }
            }
          };

          const sanitize = html => {
            const template = document.createElement("template");
            template.innerHTML = html || "";
            replaceFormulaContainers(template.content);
            for (const element of [...template.content.querySelectorAll("*")]) {
              if (dangerousTags.has(element.tagName)) {
                element.remove();
                continue;
              }
              for (const attribute of [...element.attributes]) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith("on") || name === "srcdoc")
                  element.removeAttribute(attribute.name);
                else if (name === "style") {
                  const value = attribute.value;
                  if (/url\s*\(|expression\s*\(|@import/i.test(value))
                    element.removeAttribute(attribute.name);
                }
                else if (name === "href" || name === "src") {
                  const value = safeUrl(attribute.value);
                  if (value) element.setAttribute(attribute.name, value);
                  else element.removeAttribute(attribute.name);
                }
              }
              if (element.tagName === "A") {
                element.target = "_blank";
                element.rel = "noopener noreferrer";
              }
            }
            return template.content;
          };

          const button = (label, type, id) => {
            const value = document.createElement("button");
            value.type = "button";
            value.textContent = label;
            value.addEventListener("click", () =>
              chrome.webview.postMessage({ type, id }));
            return value;
          };

          const statusText = message => {
            if (message.status === "pending") return "发送中…";
            if (message.status === "streaming") return "生成中…";
            if (message.status === "stopped") return "已停止";
            if (message.status === "failed")
              return "发送失败" + (message.errorCode ? "：" + message.errorCode : "");
            return "";
          };

          const update = (card, message, providerLabel) => {
            const signature = JSON.stringify([
              providerLabel, message.role, message.text, message.renderedTextHtml,
              message.html, message.status, message.errorCode,
              message.modeLabels, message.modelSnapshot, message.attachmentNames
            ]);
            if (card.dataset.signature === signature) return;
            card.dataset.signature = signature;
            card.className = "message " + (message.role === "user" ? "user" : "assistant");
            card.querySelector(".author").textContent =
              message.role === "user" ? "你" : providerLabel;
            const body = card.querySelector(".body");
            body.replaceChildren();
            body.style.whiteSpace = "";
            if (message.role === "user") {
              body.textContent = message.text || "";
            } else if (message.html) {
              const probe = document.createElement("template");
              probe.innerHTML = message.html;
              const rawText = probe.content.textContent || "";
              const looksLikeRawMarkdown =
                /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|>\s|\d+\.\s)/m.test(rawText) ||
                /\*\*[^*\n]+\*\*/.test(rawText);
              body.append(sanitize(
                looksLikeRawMarkdown ? message.renderedTextHtml : message.html));
            } else if (message.renderedTextHtml) {
              body.append(sanitize(message.renderedTextHtml));
            } else {
              body.textContent = message.text || "";
              body.style.whiteSpace = "pre-wrap";
            }
            void renderMath(body);
            const meta = card.querySelector(".meta");
            meta.replaceChildren();
            if (message.modelSnapshot) {
              const value = document.createElement("span");
              value.textContent = message.modelSnapshot;
              meta.append(value);
            }
            for (const mode of message.modeLabels || []) {
              const value = document.createElement("span");
              value.textContent = mode;
              meta.append(value);
            }
            for (const name of message.attachmentNames || []) {
              const value = document.createElement("span");
              value.textContent = "📎 " + name;
              meta.append(value);
            }
            meta.hidden = !meta.children.length;
            const status = card.querySelector(".status");
            status.textContent = statusText(message);
            status.hidden = !status.textContent;
          };

          const create = (message, providerLabel) => {
            const card = document.createElement("article");
            card.dataset.id = message.id;
            card.innerHTML =
              '<div class="author"></div><div class="body"></div>' +
              '<div class="meta"></div><div class="actions"></div>' +
              '<div class="status"></div>';
            const actions = card.querySelector(".actions");
            actions.append(button("复制", "copy", message.id));
            if (message.role !== "user")
              actions.append(button("重试", "retry", message.id));
            if (message.role === "user")
              actions.append(button("编辑", "edit", message.id));
            update(card, message, providerLabel);
            return card;
          };

          window.aihub = {
            render(payload) {
              document.documentElement.classList.toggle("dark", !payload.isLightTheme);
              const distanceFromBottom =
                document.documentElement.scrollHeight - innerHeight - scrollY;
              const stickToBottom = distanceFromBottom < 48;
              const incoming = new Set(payload.messages.map(message => message.id));

              for (const [id, card] of known) {
                if (!incoming.has(id)) {
                  card.remove();
                  known.delete(id);
                }
              }
              for (const message of payload.messages) {
                let card = known.get(message.id);
                if (!card) {
                  card = create(message, payload.providerLabel);
                  known.set(message.id, card);
                } else {
                  update(card, message, payload.providerLabel);
                }
                root.append(card);
              }
              let empty = root.querySelector(".empty");
              if (!payload.messages.length) {
                if (!empty) {
                  empty = document.createElement("p");
                  empty.className = "empty";
                  empty.textContent = "发送一条消息开始对话";
                  root.append(empty);
                }
              } else {
                empty?.remove();
              }
              if (stickToBottom || payload.messages.some(message =>
                  message.status === "streaming" || message.status === "pending"))
                requestAnimationFrame(() => scrollTo(0, document.documentElement.scrollHeight));
            }
          };
        })();
      </script>
    </body>
    </html>
    """;
}

public sealed record MessageActionEventArgs(string Type, string MessageId);
