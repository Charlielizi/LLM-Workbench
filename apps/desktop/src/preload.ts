import { contextBridge, ipcRenderer } from "electron";
import type { AIHubApi } from "./global";

const api: AIHubApi = {
  getSnapshot: () => ipcRenderer.invoke("app:get-snapshot"),
  createConversation: (provider) =>
    ipcRenderer.invoke("conversation:create", provider),
  sendMessage: (input) => ipcRenderer.invoke("message:send", input),
  cancelGeneration: (provider) =>
    ipcRenderer.invoke("generation:cancel", provider),
  setProviderWebsiteVisible: (provider, visible) =>
    ipcRenderer.invoke("provider:set-visible", provider, visible),
  previewTransfer: (conversationId) =>
    ipcRenderer.invoke("transfer:preview", conversationId),
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
};

contextBridge.exposeInMainWorld("aihub", api);
