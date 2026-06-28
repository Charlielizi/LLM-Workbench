import type { ProviderId, ProviderMode } from "@aihub/core";

export interface ProviderModeDefinition {
  mode: ProviderMode;
  label: string;
  matchLabels: string[];
  openerLabels?: string[];
  disabledLabels?: string[];
}

export interface ProviderDefinition {
  id: ProviderId;
  loginUrl: string;
  allowedOrigins: string[];
  newConversationUrls: string[];
  conversationUrlPattern?: RegExp;
  composerSelectors: string[];
  submitSelectors: string[];
  stopSelectors: string[];
  assistantMessageSelectors: string[];
  loginMarkers: string[];
  authBlockerSelectors?: string[];
  submitWithEnter?: boolean;
  conversationDocumentSelectors?: string[];
  fileInputSelectors: string[];
  attachmentControlSelectors: string[];
  attachmentControlLabels: string[];
  attachmentCapabilityConfidence: "verified" | "partial" | "unverified";
  modeDefinitions: ProviderModeDefinition[];
  modelControlSelectors: string[];
  capabilities: string[];
}

const commonFileInputs = [
  "input[type='file'][data-testid*='file']",
  "input[type='file'][accept]",
  "input[type='file']",
];

const commonAttachmentLabels = [
  "附件",
  "上传",
  "添加文件",
  "添加图片",
  "图片",
  "Attach",
  "Upload",
  "Add file",
  "Add photo",
];

const commonModelControls = [
  "select[aria-label*='model' i]",
  "select[name*='model' i]",
  "button[aria-label*='model' i]",
  "button[aria-label*='模型']",
  "[data-testid*='model-switcher']",
  "[data-testid*='model-selector']",
  "[class*='model-selector']",
  "[class*='model-switcher']",
];

const doubaoModes: ProviderModeDefinition[] = [
  {
    mode: "reasoning",
    label: "专家模式",
    matchLabels: ["专家"],
    openerLabels: ["快捷", "专家"],
    disabledLabels: ["快捷"],
  },
  {
    mode: "image-generation",
    label: "图像生成",
    matchLabels: ["图像生成", "图片生成"],
    openerLabels: ["更多"],
  },
  {
    mode: "coding",
    label: "编程",
    matchLabels: ["编程"],
    openerLabels: ["更多"],
  },
  {
    mode: "documents",
    label: "PPT 生成",
    matchLabels: ["PPT 生成"],
    openerLabels: ["更多"],
  },
  {
    mode: "web-search",
    label: "深入研究",
    matchLabels: ["深入研究"],
    openerLabels: ["更多"],
  },
];

function websiteControls(
  modeDefinitions: ProviderModeDefinition[],
  options?: {
    attachmentControlSelectors?: string[];
    modelControlSelectors?: string[];
    attachmentCapabilityConfidence?: ProviderDefinition["attachmentCapabilityConfidence"];
  },
): Pick<
  ProviderDefinition,
  | "fileInputSelectors"
  | "attachmentControlSelectors"
  | "attachmentControlLabels"
  | "attachmentCapabilityConfidence"
  | "modeDefinitions"
  | "modelControlSelectors"
> {
  return {
    fileInputSelectors: commonFileInputs,
    attachmentControlSelectors: options?.attachmentControlSelectors ?? [],
    attachmentControlLabels: commonAttachmentLabels,
    attachmentCapabilityConfidence:
      options?.attachmentCapabilityConfidence ?? "verified",
    modeDefinitions,
    modelControlSelectors: options?.modelControlSelectors ?? commonModelControls,
  };
}

export const providerDefinitions: Record<ProviderId, ProviderDefinition> = {
  chatgpt: {
    id: "chatgpt",
    loginUrl: "https://chatgpt.com/",
    allowedOrigins: ["https://chatgpt.com", "https://auth.openai.com"],
    newConversationUrls: ["https://chatgpt.com/"],
    conversationUrlPattern: /\/c\/([a-z0-9-]+)/,
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
    ...websiteControls([
      {
        mode: "web-search",
        label: "Deep Research",
        matchLabels: ["深度研究", "查找资料"],
        openerLabels: ["添加文件等"],
      },
      {
        mode: "image-generation",
        label: "Create Image",
        matchLabels: ["创建图片", "生成图片"],
        openerLabels: ["添加文件等"],
      },
    ], {
      attachmentControlSelectors: ["#composer-plus-btn"],
      modelControlSelectors: [
        "[data-testid='model-switcher-dropdown-button']",
      ],
    }),
    capabilities: ["web", "files", "images", "code"],
  },
  claude: {
    id: "claude",
    loginUrl: "https://claude.ai/new",
    allowedOrigins: ["https://claude.ai"],
    newConversationUrls: ["https://claude.ai/new"],
    conversationUrlPattern: /\/chat\/([a-z0-9-]+)/,
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
    ...websiteControls([], {
      attachmentControlSelectors: [
        "button[aria-label*='Attach']",
        "button[aria-label*='Upload']",
      ],
      modelControlSelectors: [
        "button[aria-label*='model' i]",
        "[data-testid*='model']",
      ],
      attachmentCapabilityConfidence: "unverified",
    }),
    capabilities: ["long-form", "files", "code"],
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
    conversationUrlPattern: /\/chat\/(\w+)/,
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
      "[data-message-id]",
      "[data-role='assistant']",
      "[data-testid*='assistant']",
      "main [data-message-role='assistant']",
      "[data-copy-telemetry='right_click_copy']",
      "[data-container-type='block-v2']",
      "[class*='assistant-message']",
      "[class*='bot-message']",
      "[class*='response-content']",
      "[class*='chat-message'][class*='bot']",
      "[class*='answer-content']",
      "[class*='markdown-body']",
      "main [class*='message-content']",
      "main [class*='markdown']",
      "main [role='article']",
      "main [role='log'] > div:last-child",
    ],
    loginMarkers: [
      "input[placeholder*='手机号']",
      "input[type='tel']",
    ],
    authBlockerSelectors: [
      "[role='dialog'] button[class*='login']",
      "[class*='modal'] button[class*='login']",
      "input[placeholder*='验证码']",
      "input[type='tel']",
    ],
    submitWithEnter: true,
    conversationDocumentSelectors: [
      "main [class*='doc_editor']",
      "main [class*='doc-editor']",
      "main [data-testid*='conversation']",
      "main",
    ],
    ...websiteControls(doubaoModes, {
      modelControlSelectors: [],
    }),
    capabilities: ["chinese", "web", "image"],
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
    conversationUrlPattern: /\/chat\/(\w+)/,
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
    ...websiteControls([], {
      attachmentControlSelectors: [".toolkit-trigger-btn"],
      modelControlSelectors: [".current-model"],
    }),
    capabilities: ["long-form", "web", "files"],
  },
  deepseek: {
    id: "deepseek",
    loginUrl: "https://chat.deepseek.com/",
    allowedOrigins: [
      "https://chat.deepseek.com",
      "https://oauth2callback.deepseek.com",
    ],
    newConversationUrls: ["https://chat.deepseek.com/"],
    conversationUrlPattern: /[?&]q=([^&]+)/,
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
    ...websiteControls([
      {
        mode: "reasoning",
        label: "Deep Think",
        matchLabels: ["深度思考"],
      },
      {
        mode: "web-search",
        label: "Smart Search",
        matchLabels: ["智能搜索"],
      },
    ], {
      modelControlSelectors: [],
    }),
    capabilities: ["reasoning", "code", "chinese"],
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
    conversationUrlPattern: /\/chat\/(\w+)/,
    composerSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "textarea[placeholder*='输入']",
      "[contenteditable='true']",
      ".ql-editor",
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
    authBlockerSelectors: [
      ".agent-dialogue__tool__login",
      ".hyc-login__close",
    ],
    ...websiteControls([
      {
        mode: "reasoning",
        label: "Deep Think",
        matchLabels: ["深度思考"],
      },
    ], {
      attachmentControlSelectors: [],
      modelControlSelectors: ["[aria-label='模型选择']"],
      attachmentCapabilityConfidence: "unverified",
    }),
    capabilities: ["chinese", "web", "image"],
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
    conversationUrlPattern: /\/chat\/(\w+)/,
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
      "div[class*='message-select-wrapper-answer']",
      "div[class*='chat-answers-card-wrap']",
      "div.chat-round.last-message-item",
      "div[data-chat-answers-wrap]",
      "div[data-chat-list-key]",
      "div.answer-common-card",
      "div.qk-markdown",
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
    ...websiteControls([
      {
        mode: "reasoning",
        label: "Thinking",
        matchLabels: ["思考"],
      },
      {
        mode: "web-search",
        label: "Research",
        matchLabels: ["研究"],
      },
      {
        mode: "image-generation",
        label: "AI Image",
        matchLabels: ["AI生图"],
        openerLabels: ["更多"],
      },
      {
        mode: "coding",
        label: "Code",
        matchLabels: ["代码"],
        openerLabels: ["更多"],
      },
      {
        mode: "documents",
        label: "PPT Create",
        matchLabels: ["PPT创作"],
        openerLabels: ["更多"],
      },
    ], {
      attachmentControlSelectors: [
        "button[aria-label='添加附件']",
      ],
      modelControlSelectors: [
        "div[type='button'][aria-haspopup='dialog'][data-state]",
      ],
      attachmentCapabilityConfidence: "partial",
    }),
    capabilities: ["chinese", "web", "files"],
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
