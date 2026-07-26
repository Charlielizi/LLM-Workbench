import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appSnapshotSchema,
  conversationIdSchema,
  conversationPinSchema,
  conversationRenameSchema,
  conversationSearchSchema,
  comparisonCreateSchema,
  comparisonSendSchema,
  conversationSetDocumentsSchema,
  conversationSetFolderSchema,
  conversationSetTagsSchema,
  conversationBulkActionSchema,
  conversationExportSchema,
  conversationImportSchema,
  documentIdSchema,
  folderCreateSchema,
  folderRenameSchema,
  tagCreateSchema,
  trashItemSchema,
  trashRestoreSchema,
  webConversationReimportSchema,
  appSettingsSchema,
  backupCreateResultSchema,
  backupIdSchema,
  backupManifestV1Schema,
  backupRestorePreviewSchema,
  backupRestoreResultSchema,
  dataExportResultSchema,
  dataImportPreviewSchema,
  dataImportResultSchema,
  dataImportTokenSchema,
  dataStorageSummarySchema,
  dataResetRequestSchema,
  dataResetResultSchema,
  settingsImportSchema,
  settingsImportPreviewSchema,
  externalUrlSchema,
  messageDeleteSchema,
  messageEditResendSchema,
  providerAdapterEventsQuerySchema,
  providerCleanModeSchema,
  providerLayoutSchema,
  providerSmokeInspectionSchema,
  systemPromptCreateSchema,
  systemPromptIdSchema,
  systemPromptSetForConversationSchema,
  systemPromptUpdateSchema,
  providerIdSchema,
  sendMessageSchema,
  transferConfirmSchema,
  transferPreviewSchema,
  insertTextSchema,
  currentWebConversationSyncResultSchema,
  webHistorySyncResultSchema,
  websiteConversationSnapshotSchema,
  updateStateSchema,
} from "@aihub/core";
import { ipcMain } from "electron";
import type { AppService } from "./app-service";
import type { UpdateService } from "./update-service";

export function registerIpc(
  service: AppService,
  updateService?: UpdateService,
): void {
  for (const channel of [
    "app:get-snapshot",
    "conversation:create",
    "conversation:select",
    "comparison:create",
    "comparison:send",
    "document:add",
    "document:list",
    "document:remove",
    "conversation:set-documents",
    "folder:list",
    "folder:create",
    "folder:rename",
    "folder:delete",
    "tag:list",
    "tag:create",
    "tag:delete",
    "conversation:set-folder",
    "conversation:set-tags",
    "conversation:bulk-action",
    "conversation:export",
    "conversation:import",
    "settings:get",
    "settings:set",
    "settings:export",
    "settings:import",
    "settings:preview-import",
    "data:get-storage-summary",
    "data:export-all",
    "data:preview-import",
    "data:import",
    "data:open-folder",
    "backup:list",
    "backup:create",
    "backup:delete",
    "backup:preview-restore",
    "backup:restore",
    "trash:list",
    "trash:restore",
    "trash:purge",
    "trash:empty",
    "trash:allow-web-reimport",
    "data:reset",
    "update:get-state",
    "update:check",
    "update:download",
    "update:install",
    "app:open-external",
    "conversation:search",
    "conversation:pin",
    "conversation:rename",
    "conversation:delete",
    "message:send",
    "message:delete",
    "message:edit-resend",
    "generation:cancel",
    "provider:set-visible",
    "provider:set-layout",
    "provider:hide-self",
    "provider:discover-models",
    "provider:recover",
    "provider:clear-site-data",
    "provider:insert-text",
    "provider:submit-enter",
    "provider:sync-current-conversation",
    "provider:sync-web-history",
    "provider:get-website-snapshot",
    "system-prompt:list",
    "system-prompt:create",
    "system-prompt:update",
    "system-prompt:delete",
    "system-prompt:set-for-conversation",
    "transfer:preview",
    "transfer:confirm",
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle("app:get-snapshot", () => appSnapshotSchema.parse(service.snapshot()));
  ipcMain.handle("conversation:create", (_event, provider) =>
    service.createConversation(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("conversation:select", (_event, conversationId) =>
    service.selectConversation(conversationIdSchema.parse(conversationId)),
  );
  ipcMain.handle("comparison:create", (_event, input) => {
    const { providers } = comparisonCreateSchema.parse(input);
    return service.createComparison(providers);
  });
  ipcMain.handle("comparison:send", (_event, input) => {
    const { sessionId, text } = comparisonSendSchema.parse(input);
    return service.sendComparison(sessionId, text);
  });
  ipcMain.handle("document:add", () => service.addDocument());
  ipcMain.handle("document:list", () => service.listDocuments());
  ipcMain.handle("document:remove", (_event, id) =>
    service.removeDocument(documentIdSchema.parse(id)),
  );
  ipcMain.handle("conversation:set-documents", (_event, input) => {
    const { conversationId, documentIds } =
      conversationSetDocumentsSchema.parse(input);
    return service.setConversationDocuments(conversationId, documentIds);
  });
  ipcMain.handle("folder:list", () => service.listFolders());
  ipcMain.handle("folder:create", (_event, input) => {
    const { name, parentId } = folderCreateSchema.parse(input);
    return service.createFolder(name, parentId);
  });
  ipcMain.handle("folder:rename", (_event, input) => {
    const { id, name } = folderRenameSchema.parse(input);
    return service.renameFolder(id, name);
  });
  ipcMain.handle("folder:delete", (_event, id) =>
    service.deleteFolder(conversationIdSchema.parse(id)),
  );
  ipcMain.handle("tag:list", () => service.listTags());
  ipcMain.handle("tag:create", (_event, input) => {
    const { name, color } = tagCreateSchema.parse(input);
    return service.createTag(name, color);
  });
  ipcMain.handle("tag:delete", (_event, id) =>
    service.deleteTag(conversationIdSchema.parse(id)),
  );
  ipcMain.handle("conversation:set-folder", (_event, input) => {
    const { conversationId, folderId } =
      conversationSetFolderSchema.parse(input);
    return service.setConversationFolder(conversationId, folderId);
  });
  ipcMain.handle("conversation:set-tags", (_event, input) => {
    const { conversationId, tagIds } =
      conversationSetTagsSchema.parse(input);
    return service.setConversationTags(conversationId, tagIds);
  });
  ipcMain.handle("conversation:bulk-action", (_event, input) =>
    service.bulkConversationAction(conversationBulkActionSchema.parse(input)),
  );
  ipcMain.handle("conversation:export", (_event, input) => {
    const { conversationId, format } =
      conversationExportSchema.parse(input);
    return service.exportConversation(conversationId, format);
  });
  ipcMain.handle("conversation:import", (_event, input) => {
    const { json } = conversationImportSchema.parse(input);
    return service.importConversation(json);
  });
  ipcMain.handle("settings:get", () => service.getSettings());
  ipcMain.handle("settings:set", (_event, input) =>
    service.setSettings(appSettingsSchema.parse(input)),
  );
  ipcMain.handle("settings:export", () => service.exportSettings());
  ipcMain.handle("settings:import", (_event, input) => {
    const { json } = settingsImportSchema.parse(input);
    return service.importSettings(json);
  });
  ipcMain.handle("settings:preview-import", (_event, input) => {
    const { json } = settingsImportSchema.parse(input);
    return settingsImportPreviewSchema.parse(
      service.previewSettingsImport(json),
    );
  });
  ipcMain.handle("data:get-storage-summary", async () =>
    dataStorageSummarySchema.parse(await service.getStorageSummary()),
  );
  ipcMain.handle("data:export-all", async () =>
    dataExportResultSchema.parse(await service.exportAllData()),
  );
  ipcMain.handle("data:preview-import", async () =>
    dataImportPreviewSchema.parse(await service.previewDataImport()),
  );
  ipcMain.handle("data:import", async (_event, token) =>
    dataImportResultSchema.parse(
      await service.importAllData(dataImportTokenSchema.parse(token)),
    ),
  );
  ipcMain.handle("data:open-folder", () => service.openDataFolder());
  ipcMain.handle("backup:list", async () =>
    backupManifestV1Schema.array().parse(await service.listBackups()),
  );
  ipcMain.handle("backup:create", async () =>
    backupCreateResultSchema.parse(await service.createBackup()),
  );
  ipcMain.handle("backup:delete", async (_event, backupId) =>
    service.deleteBackup(backupIdSchema.parse(backupId)),
  );
  ipcMain.handle("backup:preview-restore", async (_event, backupId) =>
    backupRestorePreviewSchema.parse(
      await service.previewBackupRestore(backupIdSchema.parse(backupId)),
    ),
  );
  ipcMain.handle("backup:restore", async (_event, backupId) =>
    backupRestoreResultSchema.parse(
      await service.restoreBackup(backupIdSchema.parse(backupId)),
    ),
  );
  ipcMain.handle("trash:list", () =>
    trashItemSchema.array().parse(service.listTrash()),
  );
  ipcMain.handle("trash:restore", (_event, input) => {
    const { type, id } = trashRestoreSchema.parse(input);
    return service.restoreTrash(type, id);
  });
  ipcMain.handle("trash:purge", (_event, input) => {
    const { type, id } = trashRestoreSchema.parse(input);
    return service.purgeTrash(type, id);
  });
  ipcMain.handle("trash:empty", () => service.emptyTrash());
  ipcMain.handle("trash:allow-web-reimport", (_event, input) => {
    const { provider, externalId } = webConversationReimportSchema.parse(input);
    return service.allowWebConversationReimport(provider, externalId);
  });
  ipcMain.handle("data:reset", async (_event, input) =>
    dataResetResultSchema.parse(
      await service.resetData(dataResetRequestSchema.parse(input)),
    ),
  );
  ipcMain.handle("update:get-state", () =>
    updateStateSchema.parse(requireUpdateService(updateService).getState()),
  );
  ipcMain.handle("update:check", async () =>
    updateStateSchema.parse(await requireUpdateService(updateService).check()),
  );
  ipcMain.handle("update:download", async () =>
    updateStateSchema.parse(
      await requireUpdateService(updateService).download(),
    ),
  );
  ipcMain.handle("update:install", () =>
    requireUpdateService(updateService).install(),
  );
  ipcMain.handle("app:open-external", (_event, url) =>
    service.openExternal(externalUrlSchema.parse(url)),
  );
  ipcMain.handle("conversation:search", (_event, input) => {
    const { query } = conversationSearchSchema.parse(input);
    return service.searchConversations(query);
  });
  ipcMain.handle("conversation:pin", (_event, input) => {
    const { conversationId, pinned } = conversationPinSchema.parse(input);
    return service.pinConversation(conversationId, pinned);
  });
  ipcMain.handle("conversation:rename", (_event, input) => {
    const { conversationId, title } = conversationRenameSchema.parse(input);
    return service.renameConversation(conversationId, title);
  });
  ipcMain.handle("conversation:delete", (_event, conversationId) =>
    service.deleteConversation(conversationIdSchema.parse(conversationId)),
  );
  ipcMain.handle("message:send", (_event, input) =>
    service.sendMessage(sendMessageSchema.parse(input)),
  );
  ipcMain.handle("message:delete", (_event, input) => {
    const { conversationId, messageId } = messageDeleteSchema.parse(input);
    return service.deleteMessage(conversationId, messageId);
  });
  ipcMain.handle("message:edit-resend", (_event, input) =>
    service.editAndResendMessage(messageEditResendSchema.parse(input)),
  );
  ipcMain.handle("generation:cancel", (_event, provider) =>
    service.cancel(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:set-visible", (_event, provider, visible) => {
    return service.setWebsiteVisible(
      providerIdSchema.parse(provider),
      Boolean(visible),
    );
  });
  ipcMain.handle("provider:set-layout", (_event, input) => {
    const { width } = providerLayoutSchema.parse(input);
    return service.setProviderLayout(width);
  });
  ipcMain.handle("provider:hide-self", (event) => {
    service.hideProviderByWebContents(event.sender);
  });
  ipcMain.handle("provider:discover-models", (_event, provider) =>
    service.discoverProviderModels(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:recover", (_event, provider) =>
    service.recoverProvider(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:clear-site-data", (_event, provider) =>
    service.clearProviderSiteData(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:capture-anchor", (_event, provider) =>
    service.captureProviderAnchor(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:sync-latest-response", (_event, provider) =>
    service.syncLatestProviderResponse(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:sync-web-history", async (_event, provider) =>
    webHistorySyncResultSchema.parse(
      await service.syncWebHistory(providerIdSchema.parse(provider)),
    ),
  );
  ipcMain.handle("provider:sync-current-conversation", async (event) =>
    currentWebConversationSyncResultSchema.parse(
      await service.syncCurrentWebsiteConversationByWebContents(event.sender),
    ),
  );
  ipcMain.handle("provider:get-debug-snapshot", (_event, provider) =>
    service.getProviderDebugSnapshot(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:get-website-snapshot", async (_event, provider) =>
    websiteConversationSnapshotSchema.parse(
      await service.getProviderWebsiteSnapshot(providerIdSchema.parse(provider)),
    ),
  );
  ipcMain.handle("provider:get-latest-smoke-result", (_event, provider) =>
    service.getLatestProviderSmokeResult(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("provider:get-smoke-inspection", async (_event, provider) =>
    providerSmokeInspectionSchema.parse(
      await service.getProviderSmokeInspection(providerIdSchema.parse(provider)),
    ),
  );
  ipcMain.handle("provider:list-adapter-events", (_event, input) => {
    const { provider, limit, sinceCreatedAt } = providerAdapterEventsQuerySchema.parse(input);
    return service.listProviderAdapterEvents(provider, limit, sinceCreatedAt);
  });
  ipcMain.handle("provider:set-clean-mode", (_event, input) => {
    const { provider, enabled } = providerCleanModeSchema.parse(input);
    return service.setProviderCleanMode(provider, enabled);
  });
  ipcMain.handle("provider:insert-text", async (event, input) => {
    const { text } = insertTextSchema.parse({ text: input });
    const webContents = event.sender;
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
    }
    await webContents.debugger.sendCommand("Input.insertText", {
      text,
    });
  });
  ipcMain.handle("provider:submit-enter", (_event, provider) =>
    service.submitProviderEnter(providerIdSchema.parse(provider)),
  );
  ipcMain.handle("system-prompt:list", () => service.listSystemPrompts());
  ipcMain.handle("system-prompt:create", (_event, input) =>
    service.createSystemPrompt(systemPromptCreateSchema.parse(input)),
  );
  ipcMain.handle("system-prompt:update", (_event, input) =>
    service.updateSystemPrompt(systemPromptUpdateSchema.parse(input)),
  );
  ipcMain.handle("system-prompt:delete", (_event, id) =>
    service.deleteSystemPrompt(systemPromptIdSchema.parse(id)),
  );
  ipcMain.handle("system-prompt:set-for-conversation", (_event, input) => {
    const { conversationId, systemPromptId } =
      systemPromptSetForConversationSchema.parse(input);
    return service.setConversationSystemPrompt(
      conversationId,
      systemPromptId,
    );
  });
  ipcMain.handle("transfer:preview", (_event, input) =>
    service.previewTransfer(transferPreviewSchema.parse(input)),
  );
  ipcMain.handle("transfer:confirm", (_event, input) =>
    service.confirmTransfer(transferConfirmSchema.parse(input)),
  );
  ipcMain.handle("provider:debug-dump", (_event, data: string) => {
    const outPath = join(process.cwd(), "debug-dump.txt");
    writeFileSync(outPath, data, "utf-8");
  });
}

function requireUpdateService(
  updateService: UpdateService | undefined,
): UpdateService {
  if (!updateService) throw new Error("Update service is not available.");
  return updateService;
}
