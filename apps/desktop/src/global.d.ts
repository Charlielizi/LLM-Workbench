import type {
  AppSnapshot,
  AppSettingsPayload,
  ComparisonSession,
  KnowledgeDocument,
  ConversationFolder,
  ConversationTag,
  NormalizedConversation,
  ProviderEvent,
  ProviderId,
  ProviderMode,
  OutgoingAttachment,
  SystemPrompt,
  TransferPreview,
} from "@aihub/core";

export interface AIHubApi {
  getSnapshot(): Promise<AppSnapshot>;
  createConversation(provider: ProviderId): Promise<NormalizedConversation>;
  createComparison(providers: ProviderId[]): Promise<ComparisonSession>;
  sendComparison(sessionId: string, text: string): Promise<void>;
  addDocument(): Promise<KnowledgeDocument | undefined>;
  listDocuments(): Promise<KnowledgeDocument[]>;
  removeDocument(id: string): Promise<void>;
  setConversationDocuments(
    conversationId: string,
    documentIds: string[],
  ): Promise<void>;
  listFolders(): Promise<ConversationFolder[]>;
  createFolder(
    name: string,
    parentId?: string | null,
  ): Promise<ConversationFolder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  listTags(): Promise<ConversationTag[]>;
  createTag(name: string, color: string): Promise<ConversationTag>;
  deleteTag(id: string): Promise<void>;
  setConversationFolder(
    conversationId: string,
    folderId: string | null,
  ): Promise<void>;
  setConversationTags(
    conversationId: string,
    tagIds: string[],
  ): Promise<void>;
  bulkConversationAction(input:
    | { action: "delete"; conversationIds: string[] }
    | { action: "pin"; conversationIds: string[]; pinned: boolean }
    | {
        action: "set-folder";
        conversationIds: string[];
        folderId: string | null;
      }
      | {
          action: "set-tags";
          conversationIds: string[];
          tagIds: string[];
        }
      | {
          action: "migrate";
          conversationIds: string[];
          targetProvider: ProviderId;
        }
  ): Promise<void>;
  exportConversation(
    conversationId: string,
    format: "markdown" | "json",
  ): Promise<string>;
  importConversation(json: string): Promise<NormalizedConversation>;
  getSettings(): Promise<AppSettingsPayload>;
  setSettings(settings: AppSettingsPayload): Promise<void>;
  exportSettings(): Promise<string>;
  importSettings(json: string): Promise<AppSettingsPayload>;
  openExternal(url: string): Promise<void>;
  searchConversations(query: string): Promise<NormalizedConversation[]>;
  pinConversation(conversationId: string, pinned: boolean): Promise<void>;
  renameConversation(conversationId: string, title: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  sendMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }): Promise<void>;
  getLocalFilePath(file: File): string;
  deleteMessage(conversationId: string, messageId: string): Promise<void>;
  editAndResendMessage(input: {
    conversationId: string;
    messageId: string;
    text: string;
  }): Promise<void>;
  cancelGeneration(provider: ProviderId): Promise<void>;
  setProviderWebsiteVisible(
    provider: ProviderId,
    visible: boolean,
  ): Promise<void>;
  setProviderLayout(width: number): Promise<void>;
  discoverProviderModels(provider: ProviderId): Promise<void>;
  listSystemPrompts(): Promise<SystemPrompt[]>;
  createSystemPrompt(input: {
    name: string;
    content: string;
    provider?: ProviderId | null;
    isDefault?: boolean;
  }): Promise<SystemPrompt>;
  updateSystemPrompt(input: {
    id: string;
    name: string;
    content: string;
    provider?: ProviderId | null;
    isDefault?: boolean;
  }): Promise<SystemPrompt>;
  deleteSystemPrompt(id: string): Promise<void>;
  setConversationSystemPrompt(
    conversationId: string,
    systemPromptId: string | null,
  ): Promise<void>;
  previewTransfer(input: {
    sourceConversationId: string;
    targetProvider: ProviderId;
    compressionProvider?: ProviderId | null;
  }): Promise<TransferPreview>;
  confirmTransfer(input: {
    sourceConversationId: string;
    targetProvider: ProviderId;
    compressionProvider?: ProviderId | null;
    markdown: string;
  }): Promise<NormalizedConversation>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  onProviderEvent(
    listener: (provider: ProviderId, event: ProviderEvent) => void,
  ): () => void;
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  const MAIN_WINDOW_VITE_NAME: string;

  interface Window {
    aihub: AIHubApi;
  }
}
