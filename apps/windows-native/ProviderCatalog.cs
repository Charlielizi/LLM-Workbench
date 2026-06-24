namespace AIHub.Windows;

public static class ProviderCatalog
{
    private static readonly ProviderCapabilities Core = new(
        true, true, true, true,
        new HashSet<AttachmentKind>(),
        new HashSet<ProviderMode>());

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
            "#10A37F", "G"),
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
            "#D97757", "C"),
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
            ["main [class*='doc_editor']", "main [class*='doc-editor']", "main"],
            true, "#63E6A6", "豆",
            Core with
            {
                Attachments = new HashSet<AttachmentKind>
                {
                    AttachmentKind.Image, AttachmentKind.Pdf, AttachmentKind.Word,
                    AttachmentKind.Excel, AttachmentKind.PowerPoint, AttachmentKind.Text
                }
            },
            ["input[type='file']"]),
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
            "#4F7CFF", "K"),
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
            "#4D6BFE", "D"),
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
            "#2E75F0", "元"),
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
            "#615CED", "千"),
    ];

    public static ProviderDefinition Get(ProviderId id) =>
        All.First(item => item.Id == id);

    private static ProviderDefinition Generic(
        ProviderId id, string label, string url, string[] origins,
        string[] composers, string[] submits, string[] stops,
        string[] assistants, string accent, string glyph) =>
        new(id, label, url, origins, composers, submits, stops, assistants,
            ["main"], true, accent, glyph, Core, []);
}
