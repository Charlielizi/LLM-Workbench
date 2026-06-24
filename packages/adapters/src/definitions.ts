import type { ProviderId } from "@aihub/core";

export interface ProviderDefinition {
  id: ProviderId;
  loginUrl: string;
  allowedOrigins: string[];
  newConversationUrls: string[];
  composerSelectors: string[];
  submitSelectors: string[];
  stopSelectors: string[];
  assistantMessageSelectors: string[];
  loginMarkers: string[];
  submitWithEnter?: boolean;
  conversationDocumentSelectors?: string[];
}

export const providerDefinitions: Record<ProviderId, ProviderDefinition> = {
  chatgpt: {
    id: "chatgpt",
    loginUrl: "https://chatgpt.com/",
    allowedOrigins: ["https://chatgpt.com", "https://auth.openai.com"],
    newConversationUrls: ["https://chatgpt.com/"],
    composerSelectors: [
      "#prompt-textarea",
      "[contenteditable='true'][data-lexical-editor='true']",
      "textarea[placeholder*='Message']",
    ],
    submitSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label*='Send']",
    ],
    stopSelectors: [
      "button[data-testid='stop-button']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-message-author-role='assistant']",
      "article [data-testid*='conversation-turn']",
    ],
    loginMarkers: [
      "button[data-testid='login-button']",
      "a[href*='/auth/login']",
    ],
  },
  claude: {
    id: "claude",
    loginUrl: "https://claude.ai/new",
    allowedOrigins: ["https://claude.ai"],
    newConversationUrls: ["https://claude.ai/new"],
    composerSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-testid*='composer']",
      "textarea",
    ],
    submitSelectors: [
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
    ],
    stopSelectors: [
      "button[aria-label*='Stop']",
      "button[data-testid*='stop']",
    ],
    assistantMessageSelectors: [
      "[data-testid*='assistant']",
      "[data-is-streaming]",
      "div.font-claude-response",
    ],
    loginMarkers: [
      "a[href*='/login']",
      "form[action*='login']",
      "input[type='email']",
    ],
  },
  doubao: {
    id: "doubao",
    loginUrl: "https://www.doubao.com/chat/",
    allowedOrigins: [
      "https://www.doubao.com",
      "https://doubao.com",
      "https://sso.doubao.com",
    ],
    newConversationUrls: ["https://www.doubao.com/chat/"],
    composerSelectors: [
      "#input-engine-container [contenteditable='true']",
      "#input-engine-container textarea",
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-placeholder*='发消息']",
      "textarea[placeholder*='发消息']",
      "textarea[placeholder*='输入']",
      "[contenteditable='true']",
    ],
    submitSelectors: [
      "#input-engine-container button[aria-label*='发送']",
      "#input-engine-container button[data-testid*='send']",
      "button[aria-label*='发送']",
      "button[data-testid*='send']",
      "button[type='submit']",
    ],
    stopSelectors: [
      "button[aria-label*='停止']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-testid*='assistant']",
      "[data-role='assistant']",
      "main [data-message-role='assistant']",
      "[class*='assistant-message']",
      "main [class*='message-content']",
      "main [class*='markdown']",
    ],
    loginMarkers: [
      "button[class*='login']",
      "input[placeholder*='手机号']",
      "input[type='tel']",
    ],
    submitWithEnter: true,
    conversationDocumentSelectors: [
      "main [class*='doc_editor']",
      "main [class*='doc-editor']",
      "main [data-testid*='conversation']",
      "main",
    ],
  },
  kimi: {
    id: "kimi",
    loginUrl: "https://www.kimi.com/",
    allowedOrigins: [
      "https://www.kimi.com",
      "https://kimi.com",
      "https://kimi.moonshot.cn",
    ],
    newConversationUrls: ["https://www.kimi.com/"],
    composerSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "textarea[placeholder*='输入']",
      "textarea[placeholder*='Ask']",
      "[contenteditable='true']",
    ],
    submitSelectors: [
      "button[aria-label*='发送']",
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
    ],
    stopSelectors: [
      "button[aria-label*='停止']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-role='assistant']",
      "[data-testid*='assistant']",
      "[class*='assistant'] [class*='content']",
      "[class*='segment-content']",
    ],
    loginMarkers: [
      "input[placeholder*='手机号']",
      "input[type='tel']",
      "button[class*='login']",
    ],
  },
  deepseek: {
    id: "deepseek",
    loginUrl: "https://chat.deepseek.com/",
    allowedOrigins: [
      "https://chat.deepseek.com",
      "https://oauth2callback.deepseek.com",
    ],
    newConversationUrls: ["https://chat.deepseek.com/"],
    composerSelectors: [
      "textarea[placeholder*='DeepSeek']",
      "textarea[placeholder*='发送']",
      "textarea",
      "div[contenteditable='true'][role='textbox']",
    ],
    submitSelectors: [
      "button[aria-label*='发送']",
      "button[aria-label*='Send']",
      "button[type='submit']",
    ],
    stopSelectors: [
      "button[aria-label*='停止']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-role='assistant']",
      "[class*='assistant']",
      "[class*='ds-markdown']",
    ],
    loginMarkers: [
      "input[type='email']",
      "input[placeholder*='手机号']",
      "input[type='tel']",
    ],
  },
  hunyuan: {
    id: "hunyuan",
    loginUrl: "https://yuanbao.tencent.com/",
    allowedOrigins: [
      "https://yuanbao.tencent.com",
      "https://graph.qq.com",
      "https://xui.ptlogin2.qq.com",
    ],
    newConversationUrls: ["https://yuanbao.tencent.com/"],
    composerSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "textarea[placeholder*='输入']",
      "[contenteditable='true']",
    ],
    submitSelectors: [
      "button[aria-label*='发送']",
      "button[data-testid*='send']",
      "button[class*='send']",
    ],
    stopSelectors: [
      "button[aria-label*='停止']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-role='assistant']",
      "[data-testid*='assistant']",
      "[class*='agent-message']",
      "[class*='markdown-body']",
    ],
    loginMarkers: [
      "iframe[src*='ptlogin']",
      "button[class*='login']",
      "div[class*='login'] input",
    ],
  },
  qianwen: {
    id: "qianwen",
    loginUrl: "https://www.qianwen.com/",
    allowedOrigins: [
      "https://www.qianwen.com",
      "https://qianwen.com",
      "https://passport.aliyun.com",
      "https://login.taobao.com",
    ],
    newConversationUrls: ["https://www.qianwen.com/"],
    composerSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "textarea[placeholder*='输入']",
      "textarea",
      "[contenteditable='true']",
    ],
    submitSelectors: [
      "button[aria-label*='发送']",
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
    ],
    stopSelectors: [
      "button[aria-label*='停止']",
      "button[aria-label*='Stop']",
    ],
    assistantMessageSelectors: [
      "[data-role='assistant']",
      "[data-testid*='assistant']",
      "[class*='assistant-message']",
      "[class*='markdown-body']",
    ],
    loginMarkers: [
      "input[placeholder*='手机号']",
      "input[type='tel']",
      "iframe[src*='login']",
    ],
  },
};

export function firstMatch(
  document: Document,
  selectors: readonly string[],
): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}
