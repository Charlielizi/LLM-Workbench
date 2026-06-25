namespace AIHub.Windows;

public static class ProviderCatalog
{
    private static readonly ProviderCapabilities Core = new(
        true, true, true, true,
        new HashSet<AttachmentKind>(),
        new HashSet<ProviderMode>());

    private static readonly ProviderModeDefinition[] CommonModes =
    [
        new(ProviderMode.Reasoning, "深度思考",
            ["深度思考", "深度推理", "思考", "推理", "Deep Think", "Thinking", "Reasoning"]),
        new(ProviderMode.WebSearch, "联网搜索",
            ["联网搜索", "联网", "搜索", "Web Search", "Search"]),
        new(ProviderMode.ImageGeneration, "图片生成",
            ["图片生成", "生成图片", "AI 作图", "Create image", "Image generation"]),
        new(ProviderMode.Coding, "编程",
            ["编程", "代码", "Coding", "Code"]),
        new(ProviderMode.Documents, "文档",
            ["文档", "Documents", "Document"])
    ];

    private static readonly ProviderModeDefinition[] DoubaoModes =
    [
        new(
            ProviderMode.Reasoning,
            "专家模式",
            ["专家"],
            ["快速", "专家"],
            ["快速"]),
        new(
            ProviderMode.ImageGeneration,
            "图像生成",
            ["图像生成", "图片生成"],
            ["更多"]),
        new(
            ProviderMode.Coding,
            "编程",
            ["编程"],
            ["更多"]),
        new(
            ProviderMode.Documents,
            "PPT 生成",
            ["PPT 生成"],
            ["更多"]),
        new(
            ProviderMode.WebSearch,
            "深入研究",
            ["深入研究"],
            ["更多"])
    ];

    private static readonly ProviderModeDefinition[] ChatGptModes =
    [
        new(ProviderMode.WebSearch, "深度研究",
            ["深度研究", "查找资料"], ["添加文件等"]),
        new(ProviderMode.ImageGeneration, "创建图片",
            ["创建图片", "生成图片"], ["添加文件等"])
    ];

    private static readonly ProviderModeDefinition[] DeepSeekModes =
    [
        new(ProviderMode.Reasoning, "深度思考", ["深度思考"]),
        new(ProviderMode.WebSearch, "智能搜索", ["智能搜索"])
    ];

    private static readonly ProviderModeDefinition[] HunyuanModes =
    [
        new(ProviderMode.Reasoning, "深度思考", ["深度思考"])
    ];

    private static readonly ProviderModeDefinition[] QianwenModes =
    [
        new(ProviderMode.Reasoning, "思考", ["思考"]),
        new(ProviderMode.WebSearch, "研究", ["研究"]),
        new(ProviderMode.ImageGeneration, "AI生图", ["AI生图"]),
        new(ProviderMode.Coding, "代码", ["代码"]),
        new(ProviderMode.Documents, "PPT创作", ["PPT创作"])
    ];

    public static readonly IReadOnlyList<ProviderDefinition> All =
    [
        Generic(
            ProviderId.ChatGpt, "ChatGPT", "https://chatgpt.com/",
            ["https://chatgpt.com", "https://openai.com", "https://auth.openai.com"],
            [
                "#prompt-textarea",
                "textarea[placeholder]",
                "[contenteditable='true'][data-lexical-editor='true']"
            ],
            [
                "button[data-testid='send-button']",
                "button[aria-label*='Send']",
                "button[aria-label*='发送']"
            ],
            [
                "button[data-testid='stop-button']",
                "button[aria-label*='Stop']",
                "button[aria-label*='停止']"
            ],
            [
                "[data-message-author-role='assistant']",
                "article [data-message-author-role='assistant']"
            ],
            [
                "button[data-testid='login-button']",
                "a[href*='/auth/login']"
            ],
            [],
            "#10A37F", "G",
            attachmentControls: ["#composer-plus-btn"],
            modes: ChatGptModes,
            modelControls: ["[data-testid='model-switcher-dropdown-button']"]),
        Generic(
            ProviderId.Claude, "Claude", "https://claude.ai/new",
            ["https://claude.ai", "https://anthropic.com"],
            [
                "div[contenteditable='true'][role='textbox']",
                "[contenteditable='true'][data-testid*='composer']",
                "textarea"
            ],
            [
                "button[aria-label*='Send']",
                "button[data-testid*='send']",
                "button[type='submit']"
            ],
            ["button[aria-label*='Stop']", "button[data-testid*='stop']"],
            [
                "[data-testid*='assistant']",
                "[data-is-streaming]",
                "[class*='font-claude-message']"
            ],
            [
                "a[href*='/login']",
                "form[action*='login']",
                "input[type='email']"
            ],
            [],
            "#D97757", "C",
            attachmentControls:
            [
                "button[aria-label*='Attach']",
                "button[aria-label*='Upload']"
            ],
            modes: [],
            modelControls:
            [
                "button[aria-label*='model' i]",
                "[data-testid*='model']"
            ]),
        new(
            ProviderId.Doubao, "豆包", "https://www.doubao.com/chat/",
            ["https://www.doubao.com", "https://doubao.com", "https://sso.doubao.com"],
            [
                "#input-engine-container [contenteditable='true']",
                "#input-engine-container textarea",
                "[contenteditable='true'][data-placeholder*='发消息']",
                "div[contenteditable='true'][role='textbox']"
            ],
            [
                "#input-engine-container button[aria-label*='发送']",
                "#input-engine-container button[data-testid*='send']",
                "button[aria-label*='发送']"
            ],
            ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
            ["[data-message-role='assistant']", "[data-testid*='assistant']"],
            [],
            [],
            ["main [class*='doc_editor']", "main [class*='doc-editor']", "main"],
            true, "#63E6A6", "豆",
            Core with
            {
                Attachments = new HashSet<AttachmentKind>
                {
                    AttachmentKind.Image, AttachmentKind.Pdf, AttachmentKind.Word,
                    AttachmentKind.Excel, AttachmentKind.PowerPoint, AttachmentKind.Text
                },
                Modes = DoubaoModes.Select(mode => mode.Mode).ToHashSet()
            },
            ["input[type='file']"],
            [],
            DoubaoModes,
            []),
        Generic(
            ProviderId.Kimi, "Kimi", "https://www.kimi.com/",
            ["https://www.kimi.com", "https://kimi.com", "https://moonshot.cn"],
            [
                "div[contenteditable='true'][role='textbox']",
                "div[contenteditable='true'][data-placeholder]",
                "textarea[placeholder*='输入']",
                "textarea"
            ],
            [
                "button[aria-label*='发送']",
                "button[aria-label*='Send']",
                "button[class*='send']"
            ],
            ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
            [
                "div.chat-content-item.chat-content-item-assistant",
                "[data-role='assistant']",
                "[data-testid*='assistant']",
                "[class*='markdown']"
            ],
            [],
            [],
            "#4F7CFF", "K",
            attachmentControls: [".toolkit-trigger-btn"],
            modes: [],
            modelControls: [".current-model"]),
        Generic(
            ProviderId.DeepSeek, "DeepSeek", "https://chat.deepseek.com/",
            ["https://chat.deepseek.com", "https://deepseek.com"],
            [
                "textarea",
                "div[contenteditable='true'][role='textbox']",
                "div[contenteditable='true']"
            ],
            [
                "div[role='button']",
                "button[aria-label*='发送']",
                "button[aria-label*='Send']",
                "button[type='submit']"
            ],
            ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
            [
                "[data-role='assistant']",
                "[class*='ds-markdown']",
                "[class*='markdown']"
            ],
            [
                "input[type='email']",
                "input[placeholder*='鎵嬫満鍙?]",
                "input[type='tel']"
            ],
            [],
            "#4D6BFE", "D",
            modes: DeepSeekModes,
            modelControls: []),
        Generic(
            ProviderId.Hunyuan, "腾讯元宝", "https://yuanbao.tencent.com/",
            [
                "https://yuanbao.tencent.com",
                "https://qq.com",
                "https://ptlogin2.qq.com"
            ],
            [
                "div[contenteditable='true'][role='textbox']",
                "textarea[placeholder*='输入']",
                "textarea"
            ],
            [
                "button[aria-label*='发送']",
                "button[class*='send']",
                "button[type='submit']"
            ],
            ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
            [
                "div.agent-chat__list__item--ai div.hyc-common-markdown",
                "div.hyc-common-markdown.hyc-common-markdown-style",
                "div.agent-chat__list__item.agent-chat__list__item--ai.agent-chat__list__item--last",
                "[data-role='assistant']",
                "[class*='agent-message']",
                "[class*='markdown-body']"
            ],
            [
                "iframe[src*='ptlogin']",
                "button[class*='login']",
                "div[class*='login'] input"
            ],
            [
                ".agent-dialogue__tool__login",
                ".hyc-login__close"
            ],
            "#2E75F0", "元",
            attachmentControls: [],
            modes: HunyuanModes,
            modelControls: ["[aria-label='模型选择']"]),
        Generic(
            ProviderId.Qianwen, "千问", "https://www.qianwen.com/",
            [
                "https://www.qianwen.com",
                "https://qianwen.com",
                "https://aliyun.com",
                "https://alibaba.com"
            ],
            [
                "[role='textbox']",
                "div[role='textbox']",
                "div[contenteditable='true'][role='textbox']",
                "div[contenteditable='true']",
                "textarea"
            ],
            [
                "button[aria-label='发送消息']",
                "button[aria-label*='发送']",
                "button[aria-label*='Send']",
                "button[type='submit']"
            ],
            ["button[aria-label*='停止']", "button[aria-label*='Stop']"],
            [
                "[data-role='assistant']",
                "[data-testid*='assistant']",
                "[class*='markdown-body']",
                "[class*='markdown']"
            ],
            [
                "input[placeholder*='手机号']",
                "input[type='tel']",
                "iframe[src*='login']"
            ],
            [],
            "#615CED", "千",
            attachmentControls: ["button[aria-label='添加附件']"],
            modes: QianwenModes,
            modelControls:
            [
                "div[type='button'][aria-haspopup='dialog'][data-state]"
            ]),
    ];

    static ProviderCatalog()
    {
        var qianwen = All.First(item => item.Id == ProviderId.Qianwen);
        for (var index = 0; index < qianwen.ModeDefinitions.Length; index++)
        {
            var mode = qianwen.ModeDefinitions[index];
            if (mode.Mode is ProviderMode.ImageGeneration or
                ProviderMode.Coding or
                ProviderMode.Documents)
            {
                qianwen.ModeDefinitions[index] =
                    mode with { OpenerLabels = ["\u66f4\u591a"] };
            }
        }
    }

    public static ProviderDefinition Get(ProviderId id) =>
        All.First(item => item.Id == id);

    private static ProviderDefinition Generic(
        ProviderId id, string label, string url, string[] origins,
        string[] composers, string[] submits, string[] stops,
        string[] assistants, string[] loginMarkers, string[] authBlockers,
        string accent, string glyph,
        string[]? fileInputs = null,
        string[]? attachmentControls = null,
        ProviderModeDefinition[]? modes = null,
        string[]? modelControls = null) =>
        new(id, label, url, origins, composers, submits, stops, assistants,
            loginMarkers, authBlockers, ["main"], true, accent, glyph, Core,
            fileInputs ?? ["input[type='file']"],
            attachmentControls ?? [],
            modes ?? CommonModes,
            modelControls ?? CommonModelSelectors());

    private static string[] CommonModelSelectors() =>
    [
        "select[aria-label*='model' i]",
        "select[name*='model' i]",
        "button[aria-label*='model' i]",
        "button[aria-label*='模型']",
        "[data-testid*='model-switcher']",
        "[data-testid*='model-selector']",
        "[class*='model-selector']",
        "[class*='model-switcher']"
    ];
}
