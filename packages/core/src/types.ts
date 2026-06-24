export const PROVIDER_IDS = [
  "chatgpt",
  "claude",
  "doubao",
  "kimi",
  "deepseek",
  "hunyuan",
  "qianwen",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  doubao: "豆包",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  hunyuan: "腾讯元宝",
  qianwen: "千问",
};
export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "streaming" | "completed" | "failed";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; text: string }
  | { type: "attachment"; name: string; localPath?: string }
  | { type: "citation"; title?: string; url: string };

export interface NormalizedMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: ContentBlock[];
  status: MessageStatus;
  provider: ProviderId;
  createdAt: string;
}

export interface NormalizedConversation {
  id: string;
  title: string;
  provider: ProviderId;
  externalId?: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
}

export interface ConversationRef {
  externalId?: string;
}

export interface OutgoingMessage {
  conversationId: string;
  text: string;
}

export interface ProviderState {
  authenticated: boolean;
  ready: boolean;
  degraded: boolean;
  reason?: string;
}

export type ProviderEvent =
  | { type: "auth.changed"; authenticated: boolean }
  | { type: "conversation.changed"; externalId?: string }
  | { type: "message.started"; messageId: string }
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "message.completed"; message: NormalizedMessage }
  | { type: "generation.failed"; code: string; recoverable: boolean }
  | { type: "adapter.degraded"; reason: string };

export interface ProviderAdapter {
  id: ProviderId;
  loginUrl: string;
  allowedOrigins: string[];
  detectState(): Promise<ProviderState>;
  createConversation(): Promise<ConversationRef>;
  sendMessage(input: OutgoingMessage): Promise<void>;
  observeEvents(): AsyncIterable<ProviderEvent>;
  exportConversation(): Promise<NormalizedConversation>;
  cancelGeneration(): Promise<void>;
}

export interface ProviderSummary {
  id: ProviderId;
  authenticated: boolean;
  ready: boolean;
  degraded: boolean;
  reason?: string;
  websiteVisible: boolean;
}

export interface TransferPreview {
  sourceConversationId: string;
  targetProvider: "claude";
  markdown: string;
  messageCount: number;
}

export interface AppSnapshot {
  providers: ProviderSummary[];
  conversations: NormalizedConversation[];
}
