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
import {
  appSnapshotMetadataSignature,
  conversationSnapshotSignature,
} from "../utils/snapshot-signature";
import { messageText } from "../utils/message-text";
import { translate } from "../i18n";
import { resolveLocale, useSettingsStore } from "./settings-store";

const emptySnapshot: AppSnapshot = {
  providers: [],
  conversations: [],
  comparisons: [],
};

export type WorkspaceView = "conversation" | "comparison" | "settings";
export type SettingsSection =
  | "general"
  | "appearance"
  | "providers"
  | "conversations"
  | "prompts"
  | "knowledge"
  | "shortcuts"
  | "data"
  | "about";

export interface AppState {
  snapshot: AppSnapshot;
  selectedConversationId: string | undefined;
  busy: boolean;
  error: string | undefined;
  busyConversations: Set<string>;
  messageErrors: Map<string, string>;
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
  workspaceView: WorkspaceView;
  previousWorkspaceView: Exclude<WorkspaceView, "settings">;
  providerBeforeSettings: ProviderId | undefined;
  settingsSection: SettingsSection;
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
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
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
  deleteSystemPrompt: (id: string) => Promise<boolean>;
  setConversationSystemPrompt: (
    conversationId: string,
    systemPromptId?: string,
  ) => Promise<void>;
  refreshLibraryData: () => Promise<void>;
  addDocument: () => Promise<void>;
  removeDocument: (id: string) => Promise<boolean>;
  setConversationDocuments: (
    conversationId: string,
    documentIds: string[],
  ) => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<boolean>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<boolean>;
  createTag: (name: string, color: string) => Promise<boolean>;
  deleteTag: (id: string) => Promise<boolean>;
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
  ) => Promise<boolean>;
  initialize: () => Promise<void>;
  dispose: () => void;
  createConversation: (provider: ProviderId) => Promise<void>;
  searchConversations: (query: string) => Promise<void>;
  pinConversation: (conversationId: string, pinned: boolean) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<boolean>;
  sendMessage: (input: {
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }) => Promise<boolean>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<boolean>;
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
  busyConversations: new Set(),
  messageErrors: new Map(),
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
  workspaceView: "conversation",
  previousWorkspaceView: "conversation",
  providerBeforeSettings: undefined,
  settingsSection: "general",
  documents: [],
  folders: [],
  tags: [],

  selectConversation: (id) => {
    set({ selectedConversationId: id, workspaceView: "conversation" });
    void window.aihub.selectConversation(id);
  },
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setTransfer: (transfer) => set({ transfer }),
  setShortcutHelpOpen: (shortcutHelpOpen) => set({ shortcutHelpOpen }),
  setSystemPromptModalOpen: (systemPromptModalOpen) =>
    set({ systemPromptModalOpen }),
  setComparisonSetupOpen: (comparisonSetupOpen) =>
    set({ comparisonSetupOpen }),
  setActiveComparison: (activeComparisonId) =>
    set({
      activeComparisonId,
      workspaceView: activeComparisonId ? "comparison" : "conversation",
    }),
  openSettings: (settingsSection = get().settingsSection) => {
    const current = get().workspaceView;
    const visibleProvider = get().snapshot.providers.find(
      (provider) => provider.websiteVisible,
    );
    if (visibleProvider) {
      void window.aihub.setProviderWebsiteVisible(visibleProvider.id, false);
    }
    set({
      workspaceView: "settings",
      previousWorkspaceView:
        current === "settings" ? get().previousWorkspaceView : current,
      providerBeforeSettings:
        current === "settings"
          ? get().providerBeforeSettings
          : visibleProvider?.id,
      settingsSection,
    });
  },
  closeSettings: () => {
    const state = get();
    set({
      workspaceView: state.previousWorkspaceView,
      providerBeforeSettings: undefined,
    });
    if (state.providerBeforeSettings) {
      void window.aihub.setProviderWebsiteVisible(
        state.providerBeforeSettings,
        true,
      );
    }
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),

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
      const currentSnapshot = get().snapshot;
      const hasOptimistic = currentSnapshot.conversations.some((c) =>
        c.messages.some((m) => m.id.startsWith("optimistic-")),
      );

      // Snapshot deduplication: skip if no optimistic messages and content unchanged
      if (!hasOptimistic) {
        const currentSignatures = currentSnapshot.conversations.map(
          conversationSnapshotSignature,
        );
        const nextSignatures = nextSnapshot.conversations.map(
          conversationSnapshotSignature,
        );
        if (
          currentSignatures.length === nextSignatures.length &&
          currentSignatures.every((value, index) => value === nextSignatures[index]) &&
          appSnapshotMetadataSignature(currentSnapshot) ===
            appSnapshotMetadataSignature(nextSnapshot)
        ) {
          return;
        }
      }

      // Replace optimistic messages with real ones from the snapshot
      const resolvedSnapshot = hasOptimistic
        ? {
            ...nextSnapshot,
            conversations: nextSnapshot.conversations.map((nextConv) => {
              const currentConv = currentSnapshot.conversations.find(
                (c) => c.id === nextConv.id,
              );
              if (!currentConv) return nextConv;
              const optimisticIds = new Set(
                currentConv.messages
                  .filter((m) => m.id.startsWith("optimistic-"))
                  .map((m) => m.id),
              );
              if (optimisticIds.size === 0) return nextConv;
              const realUserMessages = nextConv.messages.filter(
                (m) =>
                  m.role === "user" &&
                  !m.id.startsWith("optimistic-") &&
                  !currentConv.messages.some((cm) => cm.id === m.id),
              );
              if (realUserMessages.length > 0) {
                return {
                  ...nextConv,
                  messages: nextConv.messages.filter(
                    (m) => !optimisticIds.has(m.id),
                  ),
                };
              }
              return nextConv;
            }),
          }
        : nextSnapshot;

      const streamingConversations = new Set<string>();
      for (const conversation of resolvedSnapshot.conversations) {
        if (
          conversation.messages.some(
            (message) => message.status === "streaming",
          )
        ) {
          streamingConversations.add(conversation.id);
        }
      }

      const currentId = get().selectedConversationId;
      const hasCurrent = resolvedSnapshot.conversations.some(
        (conversation) => conversation.id === currentId,
      );
      set({
        snapshot: resolvedSnapshot,
        streamingConversations,
        selectedConversationId: hasCurrent
          ? currentId
          : resolvedSnapshot.conversations[0]?.id,
      });
    });
    unsubscribeProviderEvent = window.aihub.onProviderEvent(
      (provider, event) => {
        const label = PROVIDER_LABELS[provider];
        const locale = useSettingsStore.getState().locale;
        if (event.type === "auth.changed") {
          useToastStore.getState().addToast(
            event.authenticated
              ? translate(locale, "provider.event.authenticated", {
                  provider: label,
                })
              : translate(locale, "provider.event.expired", {
                  provider: label,
                }),
            event.authenticated ? "success" : "warning",
          );
        } else if (event.type === "adapter.degraded") {
          useToastStore
            .getState()
            .addToast(
              translate(locale, "provider.event.recovery", {
                provider: label,
                reason: event.reason,
              }),
              "error",
              7000,
            );
        } else if (event.type === "generation.failed") {
          const chinese = resolveLocale(locale) === "zh-CN";
          const detail = event.detail
            ? `${chinese ? "：" : ": "}${event.detail}`
            : "";
          const phase = event.phase
            ? `${chinese ? "（" : " ("}${event.phase}${chinese ? "）" : ")"}`
            : "";
          useToastStore
            .getState()
            .addToast(
              translate(locale, "provider.event.generationFailed", {
                provider: label,
                phase,
                code: event.code,
                detail,
              }),
              "error",
              7000,
            );
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
    try {
      const conversation = await window.aihub.createConversation(provider);
      set({ selectedConversationId: conversation.id });
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
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
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  addDocument: async () => {
    try {
      const document = await window.aihub.addDocument();
      if (document) set({ documents: await window.aihub.listDocuments() });
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  removeDocument: async (id) => {
    try {
      await window.aihub.removeDocument(id);
      set({ documents: await window.aihub.listDocuments() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  setConversationDocuments: async (conversationId, documentIds) => {
    try {
      await window.aihub.setConversationDocuments(
        conversationId,
        documentIds,
      );
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  createFolder: async (name, parentId) => {
    try {
      await window.aihub.createFolder(name, parentId ?? null);
      set({ folders: await window.aihub.listFolders() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  renameFolder: async (id, name) => {
    try {
      await window.aihub.renameFolder(id, name);
      set({ folders: await window.aihub.listFolders() });
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  deleteFolder: async (id) => {
    try {
      await window.aihub.deleteFolder(id);
      set({ folders: await window.aihub.listFolders() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  createTag: async (name, color) => {
    try {
      await window.aihub.createTag(name, color);
      set({ tags: await window.aihub.listTags() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  deleteTag: async (id) => {
    try {
      await window.aihub.deleteTag(id);
      set({ tags: await window.aihub.listTags() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  setConversationFolder: async (conversationId, folderId) => {
    try {
      await window.aihub.setConversationFolder(
        conversationId,
        folderId ?? null,
      );
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  setConversationTags: async (conversationId, tagIds) => {
    try {
      await window.aihub.setConversationTags(conversationId, tagIds);
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  bulkConversationAction: async (input) => {
    set({ busy: true });
    try {
      await window.aihub.bulkConversationAction(input);
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    } finally {
      set({ busy: false });
    }
  },

  createComparison: async (providers) => {
    set({ busy: true });
    try {
      const session = await window.aihub.createComparison(providers);
      set({
        activeComparisonId: session.id,
        comparisonSetupOpen: false,
        workspaceView: "comparison",
      });
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
    } finally {
      set({ busy: false });
    }
  },

  sendComparison: async (sessionId, text) => {
    if (!text.trim() || get().busy) return false;
    set({ busy: true });
    try {
      await window.aihub.sendComparison(sessionId, text);
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    } finally {
      set({ busy: false });
    }
  },

  refreshSystemPrompts: async () => {
    try {
      set({ systemPrompts: await window.aihub.listSystemPrompts() });
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
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
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  deleteSystemPrompt: async (id) => {
    try {
      await window.aihub.deleteSystemPrompt(id);
      set({ systemPrompts: await window.aihub.listSystemPrompts() });
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
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
      useToastStore.getState().addToast(errorText(cause), "error");
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
      if (version === searchVersion) {
        useToastStore.getState().addToast(errorText(cause), "error");
      }
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
      useToastStore.getState().addToast(errorText(cause), "error");
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
      useToastStore.getState().addToast(errorText(cause), "error");
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
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  sendMessage: async (input) => {
    const { snapshot, selectedConversationId, busyConversations } = get();
    if (
      !selectedConversationId ||
      (!input.text.trim() && !input.attachments?.length) ||
      busyConversations.has(selectedConversationId)
    ) return false;

    const selected = snapshot.conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    );
    if (!selected) return false;

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: NormalizedMessage = {
      id: optimisticId,
      conversationId: selected.id,
      role: "user",
      content: [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        ...(input.attachments ?? []).map((a) => ({
          type: "attachment" as const,
          name: a.name,
          localPath: a.localPath,
        })),
      ],
      status: "pending",
      provider: selected.provider,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      busyConversations: new Set(state.busyConversations).add(selectedConversationId),
      messageErrors: new Map(state.messageErrors),
    }));
    get().messageErrors.delete(selectedConversationId);

    set((state) => ({
      snapshot: {
        ...state.snapshot,
        conversations: state.snapshot.conversations.map((c) =>
          c.id === selectedConversationId
            ? { ...c, messages: [...c.messages, optimisticMessage] }
            : c,
        ),
      },
    }));

    try {
      await window.aihub.sendMessage({
        provider: selected.provider,
        conversationId: selected.id,
        ...input,
      });
      return true;
    } catch (cause) {
      set((state) => {
        const next = new Map(state.messageErrors);
        next.set(selectedConversationId, errorText(cause));
        return { messageErrors: next };
      });
      return false;
    } finally {
      set((state) => {
        const next = new Set(state.busyConversations);
        next.delete(selectedConversationId);
        return { busyConversations: next };
      });
    }
  },

  deleteMessage: async (conversationId, messageId) => {
    try {
      await window.aihub.deleteMessage(conversationId, messageId);
      return true;
    } catch (cause) {
      useToastStore.getState().addToast(errorText(cause), "error");
      return false;
    }
  },

  editAndResendMessage: async (conversationId, messageId, text) => {
    if (!text.trim() || get().busyConversations.has(conversationId)) return false;
    set((state) => ({
      busyConversations: new Set(state.busyConversations).add(conversationId),
      messageErrors: new Map(state.messageErrors),
    }));
    get().messageErrors.delete(conversationId);
    try {
      await window.aihub.editAndResendMessage({
        conversationId,
        messageId,
        text,
      });
      return true;
    } catch (cause) {
      set((state) => {
        const next = new Map(state.messageErrors);
        next.set(conversationId, errorText(cause));
        return { messageErrors: next };
      });
      return false;
    } finally {
      set((state) => {
        const next = new Set(state.busyConversations);
        next.delete(conversationId);
        return { busyConversations: next };
      });
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
      useToastStore.getState().addToast(errorText(cause), "error");
    }
  },

  confirmTransfer: async () => {
    const { transfer, busy } = get();
    if (!transfer || busy) return;

    set({ busy: true });
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
      useToastStore.getState().addToast(errorText(cause), "error");
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
  const latest = conversation.messages.at(-1);
  return latest ? messageText(latest).slice(0, 72) : "";
}

export function messagePreview(message: NormalizedMessage): string {
  return messageText(message).slice(0, 72);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
