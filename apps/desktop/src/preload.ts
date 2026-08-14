import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AIHubApi } from "./global";

const api: AIHubApi = {
  getSnapshot: () => ipcRenderer.invoke("app:get-snapshot"),
  createConversation: (provider) =>
    ipcRenderer.invoke("conversation:create", provider),
  selectConversation: (conversationId) =>
    ipcRenderer.invoke("conversation:select", conversationId),
  createComparison: (providers) =>
    ipcRenderer.invoke("comparison:create", { providers }),
  sendComparison: (sessionId, text) =>
    ipcRenderer.invoke("comparison:send", { sessionId, text }),
  addDocument: () => ipcRenderer.invoke("document:add"),
  listDocuments: () => ipcRenderer.invoke("document:list"),
  removeDocument: (id) => ipcRenderer.invoke("document:remove", id),
  setConversationDocuments: (conversationId, documentIds) =>
    ipcRenderer.invoke("conversation:set-documents", {
      conversationId,
      documentIds,
    }),
  listFolders: () => ipcRenderer.invoke("folder:list"),
  createFolder: (name, parentId) =>
    ipcRenderer.invoke("folder:create", { name, parentId }),
  renameFolder: (id, name) =>
    ipcRenderer.invoke("folder:rename", { id, name }),
  deleteFolder: (id) => ipcRenderer.invoke("folder:delete", id),
  listTags: () => ipcRenderer.invoke("tag:list"),
  createTag: (name, color) =>
    ipcRenderer.invoke("tag:create", { name, color }),
  deleteTag: (id) => ipcRenderer.invoke("tag:delete", id),
  setConversationFolder: (conversationId, folderId) =>
    ipcRenderer.invoke("conversation:set-folder", {
      conversationId,
      folderId,
    }),
  setConversationTags: (conversationId, tagIds) =>
    ipcRenderer.invoke("conversation:set-tags", {
      conversationId,
      tagIds,
    }),
  bulkConversationAction: (input) =>
    ipcRenderer.invoke("conversation:bulk-action", input),
  exportConversation: (conversationId, format) =>
    ipcRenderer.invoke("conversation:export", {
      conversationId,
      format,
    }),
  importConversation: (json) =>
    ipcRenderer.invoke("conversation:import", { json }),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  exportSettings: () => ipcRenderer.invoke("settings:export"),
  importSettings: (json) =>
    ipcRenderer.invoke("settings:import", { json }),
  previewSettingsImport: (json) =>
    ipcRenderer.invoke("settings:preview-import", { json }),
  getStorageSummary: () => ipcRenderer.invoke("data:get-storage-summary"),
  exportAllData: () => ipcRenderer.invoke("data:export-all"),
  previewDataImport: () => ipcRenderer.invoke("data:preview-import"),
  importAllData: (token) => ipcRenderer.invoke("data:import", token),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  createBackup: () => ipcRenderer.invoke("backup:create"),
  deleteBackup: (backupId) => ipcRenderer.invoke("backup:delete", backupId),
  previewBackupRestore: (backupId) =>
    ipcRenderer.invoke("backup:preview-restore", backupId),
  restoreBackup: (backupId) =>
    ipcRenderer.invoke("backup:restore", backupId),
  listTrash: () => ipcRenderer.invoke("trash:list"),
  restoreTrash: (type, id) =>
    ipcRenderer.invoke("trash:restore", { type, id }),
  purgeTrash: (type, id) =>
    ipcRenderer.invoke("trash:purge", { type, id }),
  emptyTrash: () => ipcRenderer.invoke("trash:empty"),
  allowWebConversationReimport: (provider, externalId) =>
    ipcRenderer.invoke("trash:allow-web-reimport", { provider, externalId }),
  resetData: (request) => ipcRenderer.invoke("data:reset", request),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  searchConversations: (query) =>
    ipcRenderer.invoke("conversation:search", { query }),
  pinConversation: (conversationId, pinned) =>
    ipcRenderer.invoke("conversation:pin", { conversationId, pinned }),
  renameConversation: (conversationId, title) =>
    ipcRenderer.invoke("conversation:rename", { conversationId, title }),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke("conversation:delete", conversationId),
  sendMessage: (input) => ipcRenderer.invoke("message:send", input),
  getLocalFilePath: (file) => webUtils.getPathForFile(file),
  deleteMessage: (conversationId, messageId) =>
    ipcRenderer.invoke("message:delete", { conversationId, messageId }),
  editAndResendMessage: (input) =>
    ipcRenderer.invoke("message:edit-resend", input),
  cancelGeneration: (provider) =>
    ipcRenderer.invoke("generation:cancel", provider),
  setProviderWebsiteVisible: (provider, visible) =>
    ipcRenderer.invoke("provider:set-visible", provider, visible),
  setProviderLayout: (layout) =>
    ipcRenderer.invoke("provider:set-layout", layout),
  discoverProviderModels: (provider) =>
    ipcRenderer.invoke("provider:discover-models", provider),
  recoverProvider: (provider) =>
    ipcRenderer.invoke("provider:recover", provider),
  clearProviderSiteData: (provider) =>
    ipcRenderer.invoke("provider:clear-site-data", provider),
  submitProviderEnter: (provider) =>
    ipcRenderer.invoke("provider:submit-enter", provider),
  captureProviderAnchor: (provider) =>
    ipcRenderer.invoke("provider:capture-anchor", provider),
  syncLatestProviderResponse: (provider) =>
    ipcRenderer.invoke("provider:sync-latest-response", provider),
  syncWebHistory: (provider) =>
    ipcRenderer.invoke("provider:sync-web-history", provider),
  getProviderDebugSnapshot: (provider) =>
    ipcRenderer.invoke("provider:get-debug-snapshot", provider),
  getProviderWebsiteSnapshot: (provider) =>
    ipcRenderer.invoke("provider:get-website-snapshot", provider),
  getLatestProviderSmokeResult: (provider) =>
    ipcRenderer.invoke("provider:get-latest-smoke-result", provider),
  getProviderSmokeInspection: (provider) =>
    ipcRenderer.invoke("provider:get-smoke-inspection", provider),
  listProviderAdapterEvents: (provider, limit, sinceCreatedAt) =>
    ipcRenderer.invoke("provider:list-adapter-events", { provider, limit, sinceCreatedAt }),
  setProviderCleanMode: (provider, enabled) =>
    ipcRenderer.invoke("provider:set-clean-mode", { provider, enabled }),
  listSystemPrompts: () => ipcRenderer.invoke("system-prompt:list"),
  createSystemPrompt: (input) =>
    ipcRenderer.invoke("system-prompt:create", input),
  updateSystemPrompt: (input) =>
    ipcRenderer.invoke("system-prompt:update", input),
  deleteSystemPrompt: (id) =>
    ipcRenderer.invoke("system-prompt:delete", id),
  setConversationSystemPrompt: (conversationId, systemPromptId) =>
    ipcRenderer.invoke("system-prompt:set-for-conversation", {
      conversationId,
      systemPromptId,
    }),
  previewTransfer: (input) =>
    ipcRenderer.invoke("transfer:preview", input),
  confirmTransfer: (input) => ipcRenderer.invoke("transfer:confirm", input),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<
      typeof listener
    >[0]) => listener(snapshot);
    ipcRenderer.on("app:snapshot", handler);
    return () => ipcRenderer.removeListener("app:snapshot", handler);
  },
  onProviderEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      ...args: Parameters<typeof listener>
    ) => listener(...args);
    ipcRenderer.on("app:provider-event", handler);
    return () => ipcRenderer.removeListener("app:provider-event", handler);
  },
  onOpenConversation: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      conversationId: string,
    ) => listener(conversationId);
    ipcRenderer.on("app:open-conversation", handler);
    return () => ipcRenderer.removeListener("app:open-conversation", handler);
  },
  onShowClientPane: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("app:show-client-pane", handler);
    return () => ipcRenderer.removeListener("app:show-client-pane", handler);
  },
  onUpdateState: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof listener>[0],
    ) => listener(state);
    ipcRenderer.on("app:update-state", handler);
    return () => ipcRenderer.removeListener("app:update-state", handler);
  },
};

contextBridge.exposeInMainWorld("aihub", api);
