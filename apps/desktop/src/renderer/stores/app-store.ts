import { create } from "zustand";
import type {
  AppSnapshot,
  ConversationFolder,
  ConversationTag,
  KnowledgeDocument,
  NormalizedConversation,
  NormalizedMessage,
  ProviderId,
  ProviderCapabilitySnapshot,
  ProviderMode,
  OutgoingAttachment,
  SystemPrompt,
  TransferPreview,
} from "@aihub/core";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import { useToastStore } from "./toast-store";

const emptySnapshot: AppSnapshot = {
  providers: [],
  conversations: [],
  comparisons: [],
};

export interface AppState {
  snapshot: AppSnapshot;
  selectedConversationId: string | undefined;
  busy: boolean;
  error: string | undefined;
  transfer: TransferPreview | undefined;
  streamingConversations: Set<string>;
  providerCapabilities: Partial<Record<ProviderId, ProviderCapabilitySnapshot>>;
  searchResults: NormalizedConversation[] | undefined;
  searchQuery: string;
  shortcutHelpOpen: boolean;
  systemPrompts: SystemPrompt[];
  systemPromptModalOpen: boolean;
  comparisonSetupOpen: boolean;
  activeComparisonId: string | undefined;
  settingsModalOpen: boolean;
  documents: KnowledgeDocument[];
  folders: ConversationFolder[];
  tags: ConversationTag[];
  selectConversation: (id: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | undefined) => void;
  setTransfer: (transfer: TransferPreview | undefined) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  setSystemPromptModalOpen: (open: boolean) => void;
  setComparisonSetupOpen: (open: boolean) => void;
  setActiveComparison: (id: string | undefined) => void;
  setSettingsModalOpen: (open: boolean) => void;
  createComparison: (providers: ProviderId[]) => Promise<void>;
  sendComparison: (sessionId: string, text: string) => Promise<boolean>;
  refreshSystemPrompts: () => Promise<void>;
  saveSystemPrompt: (input: {
    id?: string;
    name: string;
    content: string;
    provider?: ProviderId;
    isDefault: boolean;
  }) => Promise<boolean>;
  deleteSystemPrompt: (id: string) => Promise<void>;
  setConversationSystemPrompt: (
    conversationId: string,
    systemPromptId?: string,
  ) => Promise<void>;
  refreshLibraryData: () => Promise<void>;
  addDocument: () => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  setConversationDocuments: (
    conversationId: string,
    documentIds: string[],
  ) => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createTag: (name: string, color: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  setConversationFolder: (
    conversationId: string,
    folderId?: string,
  ) => Promise<void>;
  setConversationTags: (
    conversationId: string,
    tagIds: string[],
  ) => Promise<void>;
  bulkConversationAction: (input:
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
  ) => Promise<void>;
  initialize: () => Promise<void>;
  dispose: () => void;
  createConversation: (provider: ProviderId) => Promise<void>;
  searchConversations: (query: string) => Promise<void>;
  pinConversation: (conversationId: string, pinned: boolean) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  sendMessage: (input: {
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }) => Promise<boolean>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  editAndResendMessage: (
    conversationId: string,
    messageId: string,
    text: string,
  ) => Promise<boolean>;
  cancelGeneration: (provider: ProviderId) => Promise<void>;
  openTransferPreview: (
    targetProvider?: ProviderId,
    compressionProvider?: ProviderId,
  ) => Promise<void>;
  confirmTransfer: () => Promise<void>;
}

let unsubscribeSnapshot: (() => void) | undefined;
let unsubscribeProviderEvent: (() => void) | undefined;
let initializationVersion = 0;
let searchVersion = 0;

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: emptySnapshot,
  selectedConversationId: undefined,
  busy: false,
  error: undefined,
  transfer: undefined,
  streamingConversations: new Set(),
  providerCapabilities: {},
  searchResults: undefined,
  searchQuery: "",
  shortcutHelpOpen: false,
  systemPrompts: [],
  systemPromptModalOpen: false,
  comparisonSetupOpen: false,
  activeComparisonId: undefined,
  settingsModalOpen: false,
  documents: [],
  folders: [],
  tags: [],

  selectConversation: (id) => set({ selectedConversationId: id }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setTransfer: (transfer) => set({ transfer }),
  setShortcutHelpOpen: (shortcutHelpOpen) => set({ shortcutHelpOpen }),
  setSystemPromptModalOpen: (systemPromptModalOpen) =>
    set({ systemPromptModalOpen }),
  setComparisonSetupOpen: (comparisonSetupOpen) =>
    set({ comparisonSetupOpen }),
  setActiveComparison: (activeComparisonId) => set({ activeComparisonId }),
  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen }),

  initialize: async () => {
    const version = ++initializationVersion;
    let snapshot: AppSnapshot;
    try {
      snapshot = await window.aihub.getSnapshot();
    } catch (cause) {
      if (version === initializationVersion) {
        set({ error: errorText(cause) });
      }
      return;
    }
    if (version !== initializationVersion) return;

    const [systemPrompts, documents, folders, tags] = await Promise.all([
      window.aihub.listSystemPrompts(),
      window.aihub.listDocuments(),
      window.aihub.listFolders(),
      window.aihub.listTags(),
    ]);
    if (version !== initializationVersion) return;
    set({
      snapshot,
      systemPrompts,
      documents,
      folders,
      tags,
      selectedConversationId:
        get().selectedConversationId ?? snapshot.conversations[0]?.id,
    });

    unsubscribeSnapshot?.();
    unsubscribeProviderEvent?.();
    unsubscribeSnapshot = window.aihub.onSnapshot((nextSnapshot) => {
      const streamingConversations = new Set<string>();
      for (const conversation of nextSnapshot.conversations) {
        if (
          conversation.messages.some(
            (message) => message.status === "streaming",
          )
        ) {
          streamingConversations.add(conversation.id);
        }
      }

      const currentId = get().selectedConversationId;
      const hasCurrent = nextSnapshot.conversations.some(
        (conversation) => conversation.id === currentId,
      );
      set({
        snapshot: nextSnapshot,
        streamingConversations,
        selectedConversationId: hasCurrent
          ? currentId
          : nextSnapshot.conversations[0]?.id,
      });
    });
    unsubscribeProviderEvent = window.aihub.onProviderEvent(
      (provider, event) => {
        const label = PROVIDER_LABELS[provider];
        if (event.type === "auth.changed") {
          useToastStore.getState().addToast(
            event.authenticated
              ? `${label} 已登录`
              : `${label} 登录状态已失效`,
            event.authenticated ? "success" : "warning",
          );
        } else if (event.type === "adapter.degraded") {
          useToastStore
            .getState()
            .addToast(`${label} 适配器需要修复：${event.reason}`, "error", 7000);
        } else if (event.type === "generation.failed") {
          useToastStore
            .getState()
            .addToast(`${label} 生成失败：${event.code}`, "error");
        } else if (event.type === "capabilities.changed") {
          set((state) => ({
            providerCapabilities: {
              ...state.providerCapabilities,
              [provider]: event.capabilities,
            },
          }));
        }
      },
    );
  },

  dispose: () => {
    initializationVersion += 1;
    unsubscribeSnapshot?.();
    unsubscribeProviderEvent?.();
    unsubscribeSnapshot = undefined;
    unsubscribeProviderEvent = undefined;
  },

  createConversation: async (provider) => {
    set({ error: undefined });
    try {
      const conversation = await window.aihub.createConversation(provider);
      set({ selectedConversationId: conversation.id });
    } catch (cause) {
      set({ error: errorText(cause) });
      await window.aihub.setProviderWebsiteVisible(provider, true);
    }
  },

  refreshLibraryData: async () => {
    try {
      const [documents, folders, tags] = await Promise.all([
        window.aihub.listDocuments(),
        window.aihub.listFolders(),
        window.aihub.listTags(),
      ]);
      set({ documents, folders, tags });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  addDocument: async () => {
    try {
      const document = await window.aihub.addDocument();
      if (document) set({ documents: await window.aihub.listDocuments() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  removeDocument: async (id) => {
    try {
      await window.aihub.removeDocument(id);
      set({ documents: await window.aihub.listDocuments() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  setConversationDocuments: async (conversationId, documentIds) => {
    try {
      await window.aihub.setConversationDocuments(
        conversationId,
        documentIds,
      );
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  createFolder: async (name, parentId) => {
    try {
      await window.aihub.createFolder(name, parentId ?? null);
      set({ folders: await window.aihub.listFolders() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  renameFolder: async (id, name) => {
    try {
      await window.aihub.renameFolder(id, name);
      set({ folders: await window.aihub.listFolders() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  deleteFolder: async (id) => {
    try {
      await window.aihub.deleteFolder(id);
      set({ folders: await window.aihub.listFolders() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  createTag: async (name, color) => {
    try {
      await window.aihub.createTag(name, color);
      set({ tags: await window.aihub.listTags() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  deleteTag: async (id) => {
    try {
      await window.aihub.deleteTag(id);
      set({ tags: await window.aihub.listTags() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  setConversationFolder: async (conversationId, folderId) => {
    try {
      await window.aihub.setConversationFolder(
        conversationId,
        folderId ?? null,
      );
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  setConversationTags: async (conversationId, tagIds) => {
    try {
      await window.aihub.setConversationTags(conversationId, tagIds);
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  bulkConversationAction: async (input) => {
    set({ busy: true, error: undefined });
    try {
      await window.aihub.bulkConversationAction(input);
    } catch (cause) {
      set({ error: errorText(cause) });
    } finally {
      set({ busy: false });
    }
  },

  createComparison: async (providers) => {
    set({ busy: true, error: undefined });
    try {
      const session = await window.aihub.createComparison(providers);
      set({
        activeComparisonId: session.id,
        comparisonSetupOpen: false,
      });
    } catch (cause) {
      set({ error: errorText(cause) });
    } finally {
      set({ busy: false });
    }
  },

  sendComparison: async (sessionId, text) => {
    if (!text.trim() || get().busy) return false;
    set({ busy: true, error: undefined });
    try {
      await window.aihub.sendComparison(sessionId, text);
      return true;
    } catch (cause) {
      set({ error: errorText(cause) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  refreshSystemPrompts: async () => {
    try {
      set({ systemPrompts: await window.aihub.listSystemPrompts() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  saveSystemPrompt: async (input) => {
    try {
      if (input.id) {
        await window.aihub.updateSystemPrompt({
          ...input,
          id: input.id,
          provider: input.provider ?? null,
        });
      } else {
        await window.aihub.createSystemPrompt({
          ...input,
          provider: input.provider ?? null,
        });
      }
      set({ systemPrompts: await window.aihub.listSystemPrompts() });
      return true;
    } catch (cause) {
      set({ error: errorText(cause) });
      return false;
    }
  },

  deleteSystemPrompt: async (id) => {
    try {
      await window.aihub.deleteSystemPrompt(id);
      set({ systemPrompts: await window.aihub.listSystemPrompts() });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  setConversationSystemPrompt: async (
    conversationId,
    systemPromptId,
  ) => {
    try {
      await window.aihub.setConversationSystemPrompt(
        conversationId,
        systemPromptId ?? null,
      );
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  searchConversations: async (query) => {
    const normalized = query.trim();
    const version = ++searchVersion;
    if (!normalized) {
      set({ searchResults: undefined, searchQuery: "" });
      return;
    }
    set({ searchQuery: normalized });
    try {
      const searchResults = await window.aihub.searchConversations(normalized);
      if (version === searchVersion) set({ searchResults });
    } catch (cause) {
      if (version === searchVersion) set({ error: errorText(cause) });
    }
  },

  pinConversation: async (conversationId, pinned) => {
    try {
      await window.aihub.pinConversation(conversationId, pinned);
      set((state) => ({
        searchResults: state.searchResults?.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                pinned,
                pinnedAt: pinned ? new Date().toISOString() : undefined,
              }
            : conversation,
        ),
      }));
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  renameConversation: async (conversationId, title) => {
    try {
      await window.aihub.renameConversation(conversationId, title);
      set((state) => ({
        searchResults: state.searchResults?.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, title }
            : conversation,
        ),
      }));
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  deleteConversation: async (conversationId) => {
    try {
      await window.aihub.deleteConversation(conversationId);
      set((state) => ({
        searchResults: state.searchResults?.filter(
          (conversation) => conversation.id !== conversationId,
        ),
      }));
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  sendMessage: async (input) => {
    const { snapshot, selectedConversationId, busy } = get();
    if (
      !selectedConversationId ||
      (!input.text.trim() && !input.attachments?.length) ||
      busy
    ) return false;

    const selected = snapshot.conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    );
    if (!selected) return false;

    set({ busy: true, error: undefined });
    try {
      await window.aihub.sendMessage({
        provider: selected.provider,
        conversationId: selected.id,
        ...input,
      });
      return true;
    } catch (cause) {
      set({ error: errorText(cause) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  deleteMessage: async (conversationId, messageId) => {
    try {
      await window.aihub.deleteMessage(conversationId, messageId);
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  editAndResendMessage: async (conversationId, messageId, text) => {
    if (!text.trim() || get().busy) return false;
    set({ busy: true, error: undefined });
    try {
      await window.aihub.editAndResendMessage({
        conversationId,
        messageId,
        text,
      });
      return true;
    } catch (cause) {
      set({ error: errorText(cause) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  cancelGeneration: async (provider) => {
    try {
      await window.aihub.cancelGeneration(provider);
    } catch {
      return;
    }
  },

  openTransferPreview: async (targetProvider, compressionProvider) => {
    const { selectedConversationId, snapshot } = get();
    if (!selectedConversationId) return;
    const source = snapshot.conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    );
    if (!source) return;
    const resolvedTarget =
      targetProvider ??
      PROVIDER_IDS.find((provider) => provider !== source.provider);
    if (!resolvedTarget) return;
    try {
      const transfer = await window.aihub.previewTransfer({
        sourceConversationId: selectedConversationId,
        targetProvider: resolvedTarget,
        compressionProvider: compressionProvider ?? null,
      });
      set({ transfer });
    } catch (cause) {
      set({ error: errorText(cause) });
    }
  },

  confirmTransfer: async () => {
    const { transfer, busy } = get();
    if (!transfer || busy) return;

    set({ busy: true, error: undefined });
    try {
      const target = await window.aihub.confirmTransfer({
        sourceConversationId: transfer.sourceConversationId,
        targetProvider: transfer.targetProvider,
        compressionProvider: transfer.compressionProvider ?? null,
        markdown: transfer.markdown,
      });
      set({
        selectedConversationId: target.id,
        transfer: undefined,
      });
    } catch (cause) {
      set({ error: errorText(cause) });
    } finally {
      set({ busy: false });
    }
  },
}));

export function useSelectedConversation(): NormalizedConversation | undefined {
  const snapshot = useAppStore((state) => state.snapshot);
  const selectedId = useAppStore((state) => state.selectedConversationId);
  return (
    snapshot.conversations.find(
      (conversation) => conversation.id === selectedId,
    ) ?? snapshot.conversations[0]
  );
}

export function blockText(
  conversation: NormalizedConversation,
): string {
  return (
    conversation.messages
      .at(-1)
      ?.content.map((block) => ("text" in block ? block.text : ""))
      .join(" ")
      .slice(0, 72) ?? "尚无消息"
  );
}

export function messagePreview(message: NormalizedMessage): string {
  return message.content
    .map((block) => ("text" in block ? block.text : ""))
    .join(" ")
    .slice(0, 72);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
