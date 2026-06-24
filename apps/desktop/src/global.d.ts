import type {
  AppSnapshot,
  NormalizedConversation,
  ProviderEvent,
  ProviderId,
  TransferPreview,
} from "@aihub/core";

export interface AIHubApi {
  getSnapshot(): Promise<AppSnapshot>;
  createConversation(provider: ProviderId): Promise<NormalizedConversation>;
  sendMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
  }): Promise<void>;
  cancelGeneration(provider: ProviderId): Promise<void>;
  setProviderWebsiteVisible(
    provider: ProviderId,
    visible: boolean,
  ): Promise<void>;
  previewTransfer(conversationId: string): Promise<TransferPreview>;
  confirmTransfer(input: {
    sourceConversationId: string;
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
