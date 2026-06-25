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
  providerHtml?: string;
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
  pinned: boolean;
  pinnedAt?: string;
  systemPromptId?: string;
  documentIds: string[];
  folderId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
}

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  provider?: ProviderId;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonParticipant {
  conversationId: string;
  provider: ProviderId;
}

export interface ComparisonSession {
  id: string;
  title: string;
  participants: ComparisonParticipant[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  filePath: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
}

export interface ConversationTag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface AppSettingsPayload {
  theme?: "dark" | "light" | "system";
  defaultProvider?: ProviderId | null;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  providerDrawerWidth?: number;
  hasCompletedOnboarding?: boolean;
  shortcuts?: Record<string, string>;
}

export interface ConversationRef {
  externalId?: string;
}

export interface OutgoingMessage {
  conversationId: string;
  text: string;
  attachments?: OutgoingAttachment[];
  modes?: ProviderMode[];
  model?: string;
}

export const PROVIDER_MODES = [
  "web-search",
  "reasoning",
  "image-understanding",
  "image-generation",
  "coding",
  "documents",
] as const;

export type ProviderMode = (typeof PROVIDER_MODES)[number];

export const ATTACHMENT_KINDS = [
  "image",
  "pdf",
  "word",
  "excel",
  "powerpoint",
  "text",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface OutgoingAttachment {
  name: string;
  localPath: string;
  kind: AttachmentKind;
  sizeBytes: number;
}

export interface ProviderModeState {
  mode: ProviderMode;
  label: string;
  enabled: boolean;
}

export interface ProviderModelState {
  id: string;
  label: string;
}

export interface ProviderCapabilitySnapshot {
  attachments: AttachmentKind[];
  modes: ProviderModeState[];
  model?: string;
  models: ProviderModelState[];
  multipleAttachments: boolean;
  acceptedTypes: string[];
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
  | {
      type: "message.snapshot";
      messageId: string;
      text: string;
      providerHtml?: string;
    }
  | { type: "message.completed"; message: NormalizedMessage }
  | { type: "generation.failed"; code: string; recoverable: boolean }
  | {
      type: "capabilities.changed";
      capabilities: ProviderCapabilitySnapshot;
    }
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
  targetProvider: ProviderId;
  compressionProvider?: ProviderId;
  markdown: string;
  messageCount: number;
}

export interface AppSnapshot {
  providers: ProviderSummary[];
  conversations: NormalizedConversation[];
  comparisons: ComparisonSession[];
}
