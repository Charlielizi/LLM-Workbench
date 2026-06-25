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

const modes = {
  reasoning: {
    mode: "reasoning",
    label: "深度思考",
    matchLabels: [
      "深度思考",
      "深度推理",
      "思考",
      "推理",
      "Deep Think",
      "Thinking",
      "Reasoning",
    ],
  },
  webSearch: {
    mode: "web-search",
    label: "联网搜索",
    matchLabels: ["联网搜索", "联网", "搜索", "Web Search", "Search"],
  },
  imageGeneration: {
    mode: "image-generation",
    label: "图片生成",
    matchLabels: [
      "图片生成",
      "生成图片",
      "AI 作图",
      "Create image",
      "Image generation",
    ],
  },
  coding: {
    mode: "coding",
    label: "编程",
    matchLabels: ["编程", "代码", "Coding", "Code"],
  },
  documents: {
    mode: "documents",
    label: "文档",
    matchLabels: ["文档", "Documents", "Document"],
  },
} satisfies Record<string, ProviderModeDefinition>;

const doubaoModes: ProviderModeDefinition[] = [
  {
    mode: "reasoning",
    label: "专家模式",
    matchLabels: ["专家"],
    openerLabels: ["快速", "专家"],
    disabledLabels: ["快速"],
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
  },
): Pick<
  ProviderDefinition,
  | "fileInputSelectors"
  | "attachmentControlSelectors"
  | "attachmentControlLabels"
  | "modeDefinitions"
  | "modelControlSelectors"
> {
  return {
    fileInputSelectors: commonFileInputs,
    attachmentControlSelectors:
      options?.attachmentControlSelectors ?? [],
    attachmentControlLabels: commonAttachmentLabels,
    modeDefinitions,
    modelControlSelectors:
      options?.modelControlSelectors ?? commonModelControls,
  };
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
    ...websiteControls([
      {
        mode: "web-search",
        label: "深度研究",
        matchLabels: ["深度研究", "查找资料"],
        openerLabels: ["添加文件等"],
      },
      {
        mode: "image-generation",
        label: "创建图片",
        matchLabels: ["创建图片", "生成图片"],
        openerLabels: ["添加文件等"],
      },
    ], {
      attachmentControlSelectors: ["#composer-plus-btn"],
      modelControlSelectors: [
        "[data-testid='model-switcher-dropdown-button']",
      ],
    }),
    capabilities: ["联网", "文件", "图像", "代码"],
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
    ...websiteControls([], {
      attachmentControlSelectors: [
        "button[aria-label*='Attach']",
        "button[aria-label*='Upload']",
      ],
      modelControlSelectors: [
        "button[aria-label*='model' i]",
        "[data-testid*='model']",
      ],
    }),
    capabilities: ["长文本", "文件", "代码"],
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
    ...websiteControls(doubaoModes, {
      modelControlSelectors: [],
    }),
    capabilities: ["中文", "联网", "图像"],
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
    ...websiteControls([], {
      attachmentControlSelectors: [".toolkit-trigger-btn"],
      modelControlSelectors: [".current-model"],
    }),
    capabilities: ["长文本", "联网", "文件"],
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
    ...websiteControls([
      {
        mode: "reasoning",
        label: "深度思考",
        matchLabels: ["深度思考"],
      },
      {
        mode: "web-search",
        label: "智能搜索",
        matchLabels: ["智能搜索"],
      },
    ], {
      modelControlSelectors: [],
    }),
    capabilities: ["推理", "代码", "中文"],
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
    authBlockerSelectors: [
      ".agent-dialogue__tool__login",
      ".hyc-login__close",
    ],
    ...websiteControls([
      {
        mode: "reasoning",
        label: "深度思考",
        matchLabels: ["深度思考"],
      },
    ], {
      attachmentControlSelectors: ["button[aria-label='工具']"],
      modelControlSelectors: ["[aria-label='模型选择']"],
    }),
    capabilities: ["中文", "联网", "图像"],
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
    ...websiteControls([
      {
        mode: "reasoning",
        label: "思考",
        matchLabels: ["思考"],
      },
      {
        mode: "web-search",
        label: "研究",
        matchLabels: ["研究"],
      },
      {
        mode: "image-generation",
        label: "AI生图",
        matchLabels: ["AI生图"],
      },
      {
        mode: "coding",
        label: "代码",
        matchLabels: ["代码"],
      },
      {
        mode: "documents",
        label: "PPT创作",
        matchLabels: ["PPT创作"],
      },
    ], {
      attachmentControlSelectors: [
        "button[aria-label='添加附件']",
      ],
      modelControlSelectors: [
        "div[type='button'][aria-haspopup='dialog'][data-state]",
      ],
    }),
    capabilities: ["中文", "联网", "文件"],
  },
};

providerDefinitions.hunyuan.authBlockerSelectors = [
  ".agent-dialogue__tool__login",
  ".hyc-login__close",
];
providerDefinitions.hunyuan.attachmentControlSelectors = [];

providerDefinitions.qianwen.modeDefinitions =
  providerDefinitions.qianwen.modeDefinitions.map((definition) =>
    definition.mode === "image-generation" ||
      definition.mode === "coding" ||
      definition.mode === "documents"
      ? {
          ...definition,
          openerLabels: ["\u66f4\u591a"],
        }
      : definition
  );

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
