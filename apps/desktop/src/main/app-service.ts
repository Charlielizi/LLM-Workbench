import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appSnapshotSchema,
  appDataExportV1Schema,
  contentBlocksToText,
  messageToText,
  buildKnowledgeContext,
  appSettingsCompatibilitySchema,
  appSettingsSchema,
  buildCompressionPrompt,
  buildTransferDraft,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  normalizedConversationSchema,
  providerSmokeRuntimeInfoSchema,
  providerSmokeTestResultSchema,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  validateTransferMarkdown,
  wrapWithSystemPrompt,
  type AppSnapshot,
  type AppDataExportV1,
  type AppSettingsPayload,
  type BackupCreateResult,
  type BackupManifestV1,
  type BackupRestorePreview,
  type BackupRestoreResult,
  type AdapterEventRecord,
  type ComparisonSession,
  type ContentBlock,
  type ConversationFolder,
  type ConversationTag,
  type CurrentWebConversationSyncResult,
  type KnowledgeDocument,
  type DataImportPreview,
  type DataImportResult,
  type DataExportResult,
  type DataStorageSummary,
  type DataResetRequest,
  type DataResetResult,
  type NormalizedConversation,
  type NormalizedMessage,
  type ProviderEvent,
  type ProviderId,
  type ProviderApiConfig,
  type OutgoingAttachment,
  type ProviderMode,
  type ProviderBackendMode,
  type ProviderFailureOrigin,
  type ProviderSendPhase,
  type ProviderSmokeInspection,
  type ProviderSummary,
  type ProviderSmokeTestResult,
  type SystemPrompt,
  type SettingsImportPreview,
  type TrashEntityType,
  type TrashItem,
  type TransferPreview,
  type WebHistorySyncResult,
  type WebsiteConversationRef,
  type WebsiteConversationSnapshot,
} from "@aihub/core";
import { providerDefinitions } from "@aihub/adapters";
import { app, dialog, shell, type BrowserWindow } from "electron";
import { AppDatabase } from "./database";
import { ProviderRuntime } from "./provider-runtime";
import {
  ApiProviderClient,
  ManualProviderClient,
  apiKeyEnvName,
  manualRecoveryReason,
  type ProviderClient,
} from "./provider-client";
import { MockProviderClient } from "./mock-provider-client";
import { BackupService } from "./backup-service";
import type { AppNotification } from "./system-integration";

interface AppServiceOptions {
  enableScheduledBackups?: boolean;
  requestRestart?: () => void;
  onSettingsChanged?: (settings: AppSettingsPayload) => void;
  notify?: (notification: AppNotification) => void;
}

export class AppService {
  private readonly runtimes: Record<ProviderId, ProviderClient>;
  private readonly apiClients: Record<ProviderId, ProviderClient>;
  private readonly manualClients: Record<ProviderId, ProviderClient>;
  private readonly states = new Map<ProviderId, ProviderSummary>();
  private shuttingDown = false;
  private readonly activeConversations = new Map<ProviderId, string>();
  private readonly pendingMessageContexts = new Map<
    ProviderId,
    {
      conversationId: string;
      userMessageId: string;
    }
  >();
  private readonly streamingMessages = new Map<
    ProviderId,
    {
      messageId: string;
      providerMessageId: string;
      conversationId: string;
      text: string;
      content: ContentBlock[];
      sequence: number;
      providerHtml?: string;
    }
  >();
  private providerDrawerWidth = 520;
  private providerBackends: Partial<Record<ProviderId, ProviderBackendMode>> = {};
  private providerApiConfigs: Partial<Record<ProviderId, ProviderApiConfig>> = {};
  private autoSyncWebHistory = true;
  private historySyncGeneration = 0;
  private readonly historySyncs = new Map<ProviderId, Promise<WebHistorySyncResult>>();
  private readonly currentConversationSyncs = new Map<
    ProviderId,
    Promise<CurrentWebConversationSyncResult>
  >();
  private readonly providerSyncNavigation = new Set<ProviderId>();
  private readonly conversationSyncTimers = new Map<
    ProviderId,
    ReturnType<typeof setTimeout>
  >();
  private readonly backupService: BackupService;
  private scheduledBackupMaintenance?: Promise<void>;
  private pendingScheduledBackupRetention?: number;
  private automaticBackupTimer?: ReturnType<typeof setInterval>;
  private trashMaintenanceTimer?: ReturnType<typeof setInterval>;
  private readonly pendingDataImports = new Map<
    string,
    { filePath: string; sha256: string; createdAt: number }
  >();

  constructor(
    private readonly window: BrowserWindow,
    private readonly database: AppDatabase,
    private readonly userDataDir = "",
    private readonly options: AppServiceOptions = {},
  ) {
    this.backupService = new BackupService(
      database,
      userDataDir,
      app.getVersion(),
    );
    this.runtimes = Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, this.createRuntime(id)]),
    ) as Record<ProviderId, ProviderClient>;
    this.apiClients = Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, this.createApiClient(id)]),
    ) as Record<ProviderId, ProviderClient>;
    this.manualClients = Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, this.createManualClient(id)]),
    ) as Record<ProviderId, ProviderClient>;
    for (const id of PROVIDER_IDS) {
      this.states.set(id, {
        id,
        authenticated: false,
        ready: false,
        degraded: false,
        lastFailurePhase: undefined,
        lastFailureCode: undefined,
        websiteVisible: false,
      });
    }
  }

  async initialize(): Promise<void> {
    const settings = this.getSettings();
    this.database.purgeExpiredTrash(
      settings.trashRetentionDays ?? DEFAULT_APP_SETTINGS.trashRetentionDays,
    );
    this.applySettings(settings);
    this.emitSnapshot();
    if (this.autoSyncWebHistory && this.automaticWebHistorySyncAllowed()) {
      void this.startAutomaticWebHistorySync();
    }
    this.handleAutomaticBackupSettings(settings);
    this.startTrashMaintenance();
  }

  snapshot(): AppSnapshot {
    return {
      providers: [...this.states.values()],
      conversations: this.database.listConversations(),
      comparisons: this.database.listComparisonSessions(),
    };
  }

  searchConversations(query: string): NormalizedConversation[] {
    return this.database.searchConversations(query);
  }

  listSystemPrompts(): SystemPrompt[] {
    return this.database.listSystemPrompts();
  }

  createSystemPrompt(input: {
    name: string;
    content: string;
    provider?: ProviderId | null;
    isDefault?: boolean;
  }): SystemPrompt {
    const now = new Date().toISOString();
    const prompt: SystemPrompt = {
      id: randomUUID(),
      name: input.name,
      content: input.content,
      provider: input.provider ?? undefined,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.database.createSystemPrompt(prompt);
    return prompt;
  }

  updateSystemPrompt(input: {
    id: string;
    name: string;
    content: string;
    provider?: ProviderId | null;
    isDefault?: boolean;
  }): SystemPrompt {
    const existing = this.database.getSystemPrompt(input.id);
    if (!existing) {
      throw new Error(
        this.uiText("未找到系统提示词。", "System prompt was not found."),
      );
    }
    const prompt: SystemPrompt = {
      ...existing,
      name: input.name,
      content: input.content,
      provider: input.provider ?? undefined,
      isDefault: input.isDefault ?? false,
      updatedAt: new Date().toISOString(),
    };
    this.database.updateSystemPrompt(prompt);
    this.emitSnapshot();
    return prompt;
  }

  deleteSystemPrompt(id: string): void {
    if (!this.database.getSystemPrompt(id)) {
      throw new Error(
        this.uiText("未找到系统提示词。", "System prompt was not found."),
      );
    }
    this.database.deleteSystemPrompt(id);
    this.emitSnapshot();
  }

  setConversationSystemPrompt(
    conversationId: string,
    systemPromptId?: string | null,
  ): void {
    const conversation = this.requireConversation(conversationId);
    if (systemPromptId) {
      const prompt = this.database.getSystemPrompt(systemPromptId);
      if (!prompt) {
        throw new Error(
          this.uiText("未找到系统提示词。", "System prompt was not found."),
        );
      }
      if (prompt.provider && prompt.provider !== conversation.provider) {
        throw new Error(
          this.uiText(
            "该系统提示词不支持当前 Provider。",
            "System prompt does not support this provider.",
          ),
        );
      }
    }
    this.database.setConversationSystemPrompt(
      conversationId,
      systemPromptId ?? undefined,
    );
    this.emitSnapshot();
  }

  listDocuments(): KnowledgeDocument[] {
    return this.database.listDocuments();
  }

  async addDocument(): Promise<KnowledgeDocument | undefined> {
    const result = await dialog.showOpenDialog(this.window, {
      title: this.uiText("添加到本地知识库", "Add to local knowledge"),
      properties: ["openFile"],
      filters: [
        {
          name: this.uiText("支持的文档", "Supported documents"),
          extensions: ["txt", "md", "json", "csv", "pdf"],
        },
      ],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return undefined;

    const extension = path.extname(filePath).toLowerCase();
    const buffer = await readFile(filePath);
    const fileStat = await stat(filePath);
    const content =
      extension === ".pdf"
        ? await extractPdfText(buffer)
        : buffer.toString("utf8");
    const now = new Date().toISOString();
    const document: KnowledgeDocument = {
      id: randomUUID(),
      name: path.basename(filePath),
      filePath,
      content,
      mimeType: mimeTypeForExtension(extension),
      sizeBytes: fileStat.size,
      createdAt: now,
      updatedAt: now,
    };
    this.database.addDocument(document);
    return document;
  }

  removeDocument(id: string): void {
    this.database.removeDocument(id);
    this.emitSnapshot();
  }

  setConversationDocuments(
    conversationId: string,
    documentIds: string[],
  ): void {
    this.requireConversation(conversationId);
    const knownIds = new Set(
      this.database.listDocuments().map((document) => document.id),
    );
    if (documentIds.some((id) => !knownIds.has(id))) {
      throw new Error(
        this.uiText(
          "一个或多个知识文档不存在。",
          "One or more knowledge documents were not found.",
        ),
      );
    }
    this.database.setConversationDocuments(conversationId, documentIds);
    this.emitSnapshot();
  }

  listFolders(): ConversationFolder[] {
    return this.database.listFolders();
  }

  createFolder(name: string, parentId?: string | null): ConversationFolder {
    if (
      parentId &&
      !this.database.listFolders().some((folder) => folder.id === parentId)
    ) {
      throw new Error(
        this.uiText("未找到上级文件夹。", "Parent folder was not found."),
      );
    }
    const folder: ConversationFolder = {
      id: randomUUID(),
      name,
      parentId: parentId ?? undefined,
      createdAt: new Date().toISOString(),
    };
    this.database.createFolder(folder);
    return folder;
  }

  renameFolder(id: string, name: string): void {
    this.database.renameFolder(id, name);
    this.emitSnapshot();
  }

  deleteFolder(id: string): void {
    this.database.deleteFolder(id);
    this.emitSnapshot();
  }

  listTags(): ConversationTag[] {
    return this.database.listTags();
  }

  createTag(name: string, color: string): ConversationTag {
    const tag: ConversationTag = {
      id: randomUUID(),
      name,
      color,
      createdAt: new Date().toISOString(),
    };
    this.database.createTag(tag);
    return tag;
  }

  deleteTag(id: string): void {
    this.database.deleteTag(id);
    this.emitSnapshot();
  }

  setConversationFolder(
    conversationId: string,
    folderId?: string | null,
  ): void {
    this.requireConversation(conversationId);
    this.database.setConversationFolder(
      conversationId,
      folderId ?? undefined,
    );
    this.emitSnapshot();
  }

  setConversationTags(conversationId: string, tagIds: string[]): void {
    this.requireConversation(conversationId);
    const knownIds = new Set(this.database.listTags().map((tag) => tag.id));
    if (tagIds.some((id) => !knownIds.has(id))) {
      throw new Error(
        this.uiText("一个或多个标签不存在。", "One or more tags were not found."),
      );
    }
    this.database.setConversationTags(conversationId, tagIds);
    this.emitSnapshot();
  }

  async bulkConversationAction(
    input:
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
        },
  ): Promise<void> {
    for (const conversationId of input.conversationIds) {
      if (input.action === "delete") {
        this.deleteConversation(conversationId);
      } else if (input.action === "pin") {
        this.database.setConversationPinned(conversationId, input.pinned);
      } else if (input.action === "set-folder") {
        this.database.setConversationFolder(
          conversationId,
          input.folderId ?? undefined,
        );
      } else if (input.action === "set-tags") {
        this.database.setConversationTags(conversationId, input.tagIds);
      } else {
        const source = this.requireConversation(conversationId);
        if (source.provider !== input.targetProvider) {
          await this.confirmTransfer({
            sourceConversationId: conversationId,
            targetProvider: input.targetProvider,
            compressionProvider: null,
            markdown: buildTransferDraft(source),
          });
        }
      }
    }
    this.emitSnapshot();
  }

  exportConversation(
    conversationId: string,
    format: "markdown" | "json",
  ): string {
    const conversation = this.requireConversation(conversationId);
    if (format === "json") return JSON.stringify(conversation, null, 2);
    return [
      `# ${conversation.title}`,
      "",
      ...conversation.messages.flatMap((message) => [
        `## ${message.role === "user" ? "User" : "Assistant"} · ${message.createdAt}`,
        "",
        messageToText(message),
        "",
      ]),
    ].join("\n");
  }

  importConversation(json: string): NormalizedConversation {
    const imported = normalizedConversationSchema.parse(JSON.parse(json));
    const conversation = this.database.createConversation({
      id: randomUUID(),
      title: imported.title,
      provider: imported.provider,
    });
    for (const message of imported.messages) {
      this.database.addMessage({
        ...message,
        id: randomUUID(),
        conversationId: conversation.id,
      });
    }
    this.emitSnapshot();
    return this.database.getConversation(conversation.id) ?? conversation;
  }

  getSettings(): AppSettingsPayload {
    const normalized = normalizeAppSettings(
      appSettingsCompatibilitySchema.parse(this.database.getSettings()),
    );
    this.database.setSettings(normalized);
    return normalized;
  }

  setSettings(settings: AppSettingsPayload): void {
    const parsed = appSettingsSchema.parse(settings);
    const normalized = normalizeAppSettings(parsed, this.getSettings());
    const wasAutoSyncEnabled = this.autoSyncWebHistory;
    this.database.setSettings(normalized);
    this.applySettings(normalized);
    this.handleAutoSyncSettingChange(wasAutoSyncEnabled);
    this.handleAutomaticBackupSettings(normalized);
    this.applyTrashRetention(normalized);
  }

  exportSettings(): string {
    return JSON.stringify(this.getSettings(), null, 2);
  }

  importSettings(json: string): AppSettingsPayload {
    const raw = JSON.parse(json) as unknown;
    const settings = appSettingsCompatibilitySchema.parse(raw);
    const normalized = normalizeAppSettings(settings, this.getSettings());
    const wasAutoSyncEnabled = this.autoSyncWebHistory;
    this.database.setSettings(normalized);
    this.applySettings(normalized);
    this.handleAutoSyncSettingChange(wasAutoSyncEnabled);
    this.handleAutomaticBackupSettings(normalized);
    this.applyTrashRetention(normalized);
    return normalized;
  }

  previewSettingsImport(json: string): SettingsImportPreview {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        this.uiText(
          "设置文件必须包含 JSON 对象。",
          "Settings file must contain a JSON object.",
        ),
      );
    }
    const parsed = appSettingsCompatibilitySchema.parse(raw);
    const current = this.getSettings();
    const candidate = normalizeAppSettings(parsed, current);
    const knownKeys = new Set(Object.keys(appSettingsSchema.shape));
    const ignoredKeys = Object.keys(raw).filter((key) => !knownKeys.has(key));
    const rawSettings = raw as Record<string, unknown>;
    const providerValues = [
      rawSettings.defaultProvider,
      ...(Array.isArray(rawSettings.enabledProviders)
        ? rawSettings.enabledProviders
        : []),
      ...(Array.isArray(rawSettings.providerOrder)
        ? rawSettings.providerOrder
        : []),
    ];
    const ignoredProviders = [
      ...new Set(
        providerValues.filter(
          (provider): provider is string =>
            typeof provider === "string" &&
            !PROVIDER_IDS.includes(provider as ProviderId),
        ),
      ),
    ];
    const changes = Object.keys(candidate)
      .filter(
        (key) =>
          JSON.stringify(current[key as keyof AppSettingsPayload]) !==
          JSON.stringify(candidate[key as keyof AppSettingsPayload]),
      )
      .map((key) => ({
        key,
        before: current[key as keyof AppSettingsPayload],
        after: candidate[key as keyof AppSettingsPayload],
      }));
    return {
      candidate,
      changes,
      ignoredKeys,
      warnings: [
        ...(ignoredKeys.length > 0
          ? [
              this.uiText(
                "部分不受支持的设置将被忽略。",
                "Some unsupported settings will be ignored.",
              ),
            ]
          : []),
        ...(ignoredProviders.length > 0
          ? [
              this.uiText(
                `未知 Provider 已被忽略：${ignoredProviders.join(", ")}`,
                `Unknown providers were ignored: ${ignoredProviders.join(", ")}`,
              ),
            ]
          : []),
      ],
    };
  }

  async getStorageSummary(): Promise<DataStorageSummary> {
    const metrics = this.database.getStorageMetrics();
    const databasePath = path.join(this.userDataDir, "aihub.sqlite");
    const databaseBytes = await stat(databasePath)
      .then((entry) => entry.size)
      .catch(() => 0);
    return {
      userDataPath: this.userDataDir,
      databaseBytes,
      ...metrics,
    };
  }

  async openDataFolder(): Promise<void> {
    const error = await shell.openPath(this.userDataDir);
    if (error) throw new Error(error);
  }

  listTrash(): TrashItem[] {
    const settings = this.getSettings();
    return this.database.listTrash(
      settings.trashRetentionDays ?? DEFAULT_APP_SETTINGS.trashRetentionDays,
    );
  }

  restoreTrash(type: TrashEntityType, id: string): void {
    this.database.restoreTrash(type, id);
    this.emitSnapshot();
  }

  purgeTrash(type: TrashEntityType, id: string): void {
    this.database.purgeTrash(type, id);
    this.emitSnapshot();
  }

  emptyTrash(): void {
    this.database.emptyTrash();
    this.emitSnapshot();
  }

  allowWebConversationReimport(
    provider: ProviderId,
    externalId: string,
  ): void {
    this.database.allowWebConversationReimport(provider, externalId);
  }

  async listBackups(): Promise<BackupManifestV1[]> {
    return this.backupService.list();
  }

  async createBackup(): Promise<BackupCreateResult> {
    const settings = this.getSettings();
    return this.backupService.create(
      "manual",
      settings.backupRetentionDays ?? DEFAULT_APP_SETTINGS.backupRetentionDays,
    );
  }

  async deleteBackup(backupId: string): Promise<void> {
    await this.backupService.delete(backupId);
  }

  async previewBackupRestore(
    backupId: string,
  ): Promise<BackupRestorePreview> {
    const preview = await this.backupService.previewRestore(backupId);
    return {
      ...preview,
      warnings: [
        this.uiText(
          "Provider 网站 Cookie 和登录态不在备份中，恢复后保持不变。",
          "Provider website cookies and login state are not part of this backup and will remain unchanged.",
        ),
        this.uiText(
          "恢复将替换全部 AIHub 本地会话、设置、提示词和知识内容。",
          "Restoring replaces all AIHub local conversations, settings, prompts, and knowledge content.",
        ),
      ],
    };
  }

  async restoreBackup(backupId: string): Promise<BackupRestoreResult> {
    const settings = this.getSettings();
    const backup = await this.backupService.scheduleRestore(
      backupId,
      settings.backupRetentionDays ?? DEFAULT_APP_SETTINGS.backupRetentionDays,
    );
    setTimeout(() => this.options.requestRestart?.(), 100);
    return { scheduled: true, backupId: backup.id };
  }

  async createPreUpdateBackup(): Promise<BackupManifestV1> {
    const settings = this.getSettings();
    return (
      await this.backupService.create(
        "pre-update",
        settings.backupRetentionDays ??
          DEFAULT_APP_SETTINGS.backupRetentionDays,
      )
    ).backup;
  }

  async resetData(request: DataResetRequest): Promise<DataResetResult> {
    const settings = this.getSettings();
    let backupId: string | undefined;
    if (
      request.createBackup &&
      (request.scope === "local-content" || request.scope === "everything")
    ) {
      const result = await this.backupService.create(
        "pre-reset",
        settings.backupRetentionDays ??
          DEFAULT_APP_SETTINGS.backupRetentionDays,
      );
      backupId = result.backup.id;
    }
    if (
      request.scope === "provider-sessions" ||
      request.scope === "everything"
    ) {
      for (const provider of PROVIDER_IDS) {
        await this.clearProviderSiteData(provider);
      }
    }
    if (
      request.scope === "local-content" ||
      request.scope === "everything"
    ) {
      this.database.clearLocalContent({
        resetSettings: request.scope === "everything",
      });
      this.activeConversations.clear();
      this.pendingMessageContexts.clear();
      this.streamingMessages.clear();
      if (request.scope === "everything") {
        this.database.setSettings(DEFAULT_APP_SETTINGS);
        this.applySettings(DEFAULT_APP_SETTINGS);
      }
      this.emitSnapshot();
    }
    const scheduledRestart = Boolean(this.options.requestRestart);
    if (scheduledRestart) setTimeout(() => this.options.requestRestart?.(), 100);
    return { scheduledRestart, backupId };
  }

  async exportAllData(): Promise<DataExportResult> {
    const result = await dialog.showSaveDialog(this.window, {
      title: this.uiText("导出 AIHub 数据", "Export AIHub data"),
      defaultPath: `aihub-data-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "AIHub JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const conversations = this.database
      .listConversations(true)
      .map(sanitizeConversationForExport);
    const payload: AppDataExportV1 = {
      format: "aihub-data",
      version: 1,
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      conversations,
      folders: this.database.listFolders(),
      tags: this.database.listTags(),
      systemPrompts: this.database.listSystemPrompts(),
      documents: this.database.listDocuments().map((document) => ({
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
    };
    const temporaryPath = `${result.filePath}.${randomUUID()}.tmp`;
    try {
      const validatedPayload = appDataExportV1Schema.parse(payload);
      await writeFile(
        temporaryPath,
        JSON.stringify(validatedPayload, null, 2),
        "utf8",
      );
      await rename(temporaryPath, result.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return {
      canceled: false,
      path: result.filePath,
      conversationCount: conversations.length,
      messageCount: conversations.reduce(
        (total, conversation) => total + conversation.messages.length,
        0,
      ),
    };
  }

  async previewDataImport(): Promise<DataImportPreview> {
    this.prunePendingDataImports();
    const result = await dialog.showOpenDialog(this.window, {
      title: this.uiText("导入 AIHub 数据", "Import AIHub data"),
      properties: ["openFile"],
      filters: [{ name: "AIHub JSON", extensions: ["json"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true };

    const fileStat = await stat(filePath);
    if (fileStat.size > 512 * 1024 * 1024) {
      throw new Error(
        this.uiText(
          "数据文件超过 512 MB，无法安全导入。",
          "The data file exceeds the 512 MB safety limit.",
        ),
      );
    }
    const buffer = await readFile(filePath);
    const payload = appDataExportV1Schema.parse(
      JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, "")) as unknown,
    );
    const analysis = this.database.analyzeDataImport(payload);
    const token = randomUUID();
    this.pendingDataImports.set(token, {
      filePath,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      createdAt: Date.now(),
    });
    const warnings = [
      this.uiText(
        "导入采用合并模式，不会覆盖现有同 ID 数据。",
        "Import uses merge mode and never overwrites existing records with the same ID.",
      ),
    ];
    if (analysis.skippedConflictCount > 0) {
      warnings.push(
        this.uiText(
          `将忽略 ${analysis.skippedConflictCount} 条冲突数据。`,
          `${analysis.skippedConflictCount} conflicting records will be skipped.`,
        ),
      );
    }
    if (analysis.ignoredKnowledgeDocumentCount > 0) {
      warnings.push(
        this.uiText(
          `将忽略 ${analysis.ignoredKnowledgeDocumentCount} 条知识库元数据；导出文件不包含知识正文或原始路径。`,
          `${analysis.ignoredKnowledgeDocumentCount} knowledge metadata records will be ignored; exports do not contain document text or original paths.`,
        ),
      );
    }
    if (analysis.adjustedDefaultPromptCount > 0) {
      warnings.push(
        this.uiText(
          `已有默认提示词的 ${analysis.adjustedDefaultPromptCount} 个作用域将保留当前默认值；导入的提示词仍会保存为非默认。`,
          `${analysis.adjustedDefaultPromptCount} scopes already have a default prompt. Existing defaults will remain, and imported prompts will be saved as non-default.`,
        ),
      );
    }
    return {
      canceled: false,
      token,
      fileName: path.basename(filePath),
      conversationCount: analysis.conversationCount,
      messageCount: analysis.messageCount,
      folderCount: analysis.folderCount,
      tagCount: analysis.tagCount,
      systemPromptCount: analysis.systemPromptCount,
      conflictCount: analysis.skippedConflictCount,
      ignoredKnowledgeDocumentCount:
        analysis.ignoredKnowledgeDocumentCount,
      adjustedDefaultPromptCount: analysis.adjustedDefaultPromptCount,
      warnings,
    };
  }

  async importAllData(token: string): Promise<DataImportResult> {
    this.prunePendingDataImports();
    const pending = this.pendingDataImports.get(token);
    if (!pending) {
      throw new Error(
        this.uiText(
          "导入预览已过期，请重新选择文件。",
          "The import preview expired. Choose the file again.",
        ),
      );
    }
    const buffer = await readFile(pending.filePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== pending.sha256) {
      this.pendingDataImports.delete(token);
      throw new Error(
        this.uiText(
          "文件在预览后发生变化，请重新预览。",
          "The file changed after preview. Preview it again.",
        ),
      );
    }
    const payload = appDataExportV1Schema.parse(
      JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, "")) as unknown,
    );
    this.pendingDataImports.delete(token);
    const imported = this.database.importAppData(payload);
    this.emitSnapshot();
    return imported;
  }

  private prunePendingDataImports(): void {
    const cutoff = Date.now() - 30 * 60 * 1_000;
    for (const [token, pending] of this.pendingDataImports) {
      if (pending.createdAt < cutoff) this.pendingDataImports.delete(token);
    }
  }

  async openExternal(url: string): Promise<void> {
    await shell.openExternal(url);
  }

  async createComparison(
    providers: ProviderId[],
  ): Promise<ComparisonSession> {
    providers.forEach((provider) => this.ensureWebBackend(provider));
    const participants: ComparisonSession["participants"] = [];
    for (const provider of providers) {
      await this.runtimes[provider].createConversation();
      const conversation = this.database.createConversation({
        id: randomUUID(),
        title: this.uiText(
          `对比：${PROVIDER_LABELS[provider]}`,
          `Comparison: ${PROVIDER_LABELS[provider]}`,
        ),
        provider,
      });
      this.activeConversations.set(provider, conversation.id);
      participants.push({
        conversationId: conversation.id,
        provider,
      });
    }

    const now = new Date().toISOString();
    const session: ComparisonSession = {
      id: randomUUID(),
      title: this.uiText("对比 ", "Compare ") +
        providers.map((provider) => PROVIDER_LABELS[provider]).join(" / "),
      participants,
      createdAt: now,
      updatedAt: now,
    };
    this.database.createComparisonSession(session);
    this.emitSnapshot();
    return session;
  }

  async sendComparison(sessionId: string, text: string): Promise<void> {
    const session = this.database.getComparisonSession(sessionId);
    if (!session) {
      throw new Error(
        this.uiText("未找到对比会话。", "Comparison session was not found."),
      );
    }
    await Promise.all(
      session.participants.map((participant) =>
        this.sendMessage({
          provider: participant.provider,
          conversationId: participant.conversationId,
          text,
        }),
      ),
    );
    this.database.touchComparisonSession(sessionId);
    this.emitSnapshot();
  }

  pinConversation(conversationId: string, pinned: boolean): void {
    this.requireConversation(conversationId);
    this.database.setConversationPinned(conversationId, pinned);
    this.emitSnapshot();
  }

  renameConversation(conversationId: string, title: string): void {
    this.requireConversation(conversationId);
    this.database.renameConversation(conversationId, title);
    this.emitSnapshot();
  }

  deleteConversation(conversationId: string): void {
    const conversation = this.requireConversation(conversationId);
    this.database.deleteConversation(conversationId);
    if (this.activeConversations.get(conversation.provider) === conversationId) {
      this.activeConversations.delete(conversation.provider);
    }
    this.emitSnapshot();
  }

  deleteMessage(conversationId: string, messageId: string): void {
    this.requireConversation(conversationId);
    const message = this.database.getMessage(messageId);
    if (!message || message.conversationId !== conversationId) {
      throw new Error(
        this.uiText(
          "当前会话中未找到这条消息。",
          "Message was not found in this conversation.",
        ),
      );
    }
    if (message.status === "streaming") {
      throw new Error(
        this.uiText(
          "请先停止生成，再删除这条消息。",
          "Stop generation before deleting this message.",
        ),
      );
    }
    this.database.deleteMessage(conversationId, messageId);
    this.emitSnapshot();
  }

  async editAndResendMessage(input: {
    conversationId: string;
    messageId: string;
    text: string;
  }): Promise<void> {
    const conversation = this.requireConversation(input.conversationId);
    const message = this.database.getMessage(input.messageId);
    if (
      !message ||
      message.conversationId !== input.conversationId ||
      message.role !== "user"
    ) {
      throw new Error(
        this.uiText(
          "只能编辑并重新发送用户消息。",
          "Only user messages can be edited and resent.",
        ),
      );
    }

    this.database.deleteMessagesFrom(input.conversationId, input.messageId);
    this.emitSnapshot();
    await this.sendMessage({
      provider: conversation.provider,
      conversationId: conversation.id,
      text: input.text,
    });
  }

  async createConversation(provider: ProviderId): Promise<NormalizedConversation> {
    if (this.backendMode(provider) === "api") {
      const state = await this.apiClients[provider].detectState();
      if (!state.ready) {
        throw new Error(state.reason ?? this.backendUnavailableReason("api", provider));
      }
      await this.apiClients[provider].createConversation();
    } else if (this.backendMode(provider) === "manual") {
      await this.manualClients[provider].createConversation();
    } else {
      await this.runtimes[provider].createConversation();
    }
    const conversation = this.database.createConversation({
      id: randomUUID(),
      title: this.uiText(
        `新建 ${PROVIDER_LABELS[provider]} 会话`,
        `New ${PROVIDER_LABELS[provider]} conversation`,
      ),
      provider,
    });
    this.activeConversations.set(provider, conversation.id);
    this.emitSnapshot();
    return conversation;
  }

  async selectConversation(conversationId: string): Promise<void> {
    if (this.isUnavailableForPersistence()) return;
    const conversation = this.database.getConversation(conversationId);
    if (!conversation) return;
    this.activeConversations.set(conversation.provider, conversationId);
    if (this.backendMode(conversation.provider) !== "web") return;
    if (conversation.externalId) {
      try {
        this.providerSyncNavigation.add(conversation.provider);
        await this.runtimes[conversation.provider].navigateToConversation(
          conversation.externalId,
        );
        if (this.isUnavailableForPersistence()) return;
        if (this.conversationNeedsRefresh(conversation)) {
          this.database.setConversationSyncState(conversation.id, "syncing");
          this.emitSnapshot();
          const snapshot = await this.runtimes[conversation.provider].extractCurrentConversation();
          if (this.isUnavailableForPersistence()) return;
          this.importWebsiteMessages(conversation, snapshot);
          this.emitSnapshot();
        }
      } catch (error) {
        if (this.isUnavailableForPersistence()) return;
        this.database.setConversationSyncState(conversation.id, "error", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.emitSnapshot();
      } finally {
        this.providerSyncNavigation.delete(conversation.provider);
      }
    }
  }

  private async ensureScheduledBackup(retentionDays: number): Promise<void> {
    try {
      await this.backupService.pruneScheduled(retentionDays);
      if (await this.backupService.hasRecentScheduledBackup()) return;
      await this.backupService.create("scheduled", retentionDays);
    } catch (error) {
      console.warn("Scheduled backup failed:", error);
    }
  }

  private handleAutomaticBackupSettings(settings: AppSettingsPayload): void {
    if (!this.options.enableScheduledBackups || !settings.automaticBackup) {
      if (this.automaticBackupTimer) {
        clearInterval(this.automaticBackupTimer);
        this.automaticBackupTimer = undefined;
      }
      return;
    }
    this.requestScheduledBackupMaintenance(
      settings.backupRetentionDays ??
        DEFAULT_APP_SETTINGS.backupRetentionDays,
    );
    if (this.automaticBackupTimer) return;
    this.automaticBackupTimer = setInterval(() => {
      if (this.shuttingDown) return;
      const current = this.getSettings();
      if (!current.automaticBackup) return;
      this.requestScheduledBackupMaintenance(
        current.backupRetentionDays ??
          DEFAULT_APP_SETTINGS.backupRetentionDays,
      );
    }, 60 * 60 * 1_000);
    this.automaticBackupTimer.unref();
  }

  private requestScheduledBackupMaintenance(retentionDays: number): void {
    if (this.shuttingDown) return;
    this.pendingScheduledBackupRetention = retentionDays;
    if (this.scheduledBackupMaintenance) return;
    const requestedRetention = this.pendingScheduledBackupRetention;
    this.pendingScheduledBackupRetention = undefined;
    this.scheduledBackupMaintenance = this.ensureScheduledBackup(
      requestedRetention,
    )
      .finally(() => {
        this.scheduledBackupMaintenance = undefined;
        const pendingRetention = this.pendingScheduledBackupRetention;
        if (pendingRetention !== undefined) {
          this.requestScheduledBackupMaintenance(pendingRetention);
        }
      });
  }

  private startTrashMaintenance(): void {
    if (!this.options.enableScheduledBackups || this.trashMaintenanceTimer) {
      return;
    }
    this.trashMaintenanceTimer = setInterval(() => {
      if (!this.shuttingDown) this.applyTrashRetention(this.getSettings());
    }, 60 * 60 * 1_000);
    this.trashMaintenanceTimer.unref();
  }

  private applyTrashRetention(settings: AppSettingsPayload): void {
    const purged = this.database.purgeExpiredTrash(
      settings.trashRetentionDays ??
        DEFAULT_APP_SETTINGS.trashRetentionDays,
    );
    if (purged > 0) this.emitSnapshot();
  }

  async sendMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }): Promise<void> {
    this.throwIfUnavailableForPersistence();
    if (this.backendMode(input.provider) === "manual") {
      await this.sendManualMessage(input);
      return;
    }
    if (this.backendMode(input.provider) === "api") {
      await this.sendApiMessage(input);
      return;
    }
    this.ensureWebBackend(input.provider);
    this.clearProviderFailureState(input.provider);
    const conversation = this.database.getConversation(input.conversationId);
    if (!conversation || conversation.provider !== input.provider) {
      throw new Error(
        this.uiText(
          "该会话不属于所选 Provider。",
          "Conversation does not belong to the selected provider.",
        ),
      );
    }
    this.activeConversations.set(input.provider, input.conversationId);
    const userMessage = {
      ...this.message(input.conversationId, input.provider, "user", input.text),
      content: [
        ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
        ...(input.attachments ?? []).map((attachment) => ({
          type: "attachment" as const,
          name: attachment.name,
          localPath: attachment.localPath,
        })),
      ],
      status: "pending" as const,
      statusPhase: "checking-auth" as const,
    };
    this.pendingMessageContexts.set(input.provider, {
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
    });
    this.database.addMessage(userMessage);
    this.emitSnapshot();
    try {
      await this.runtimes[input.provider].attach();
      this.throwIfUnavailableForPersistence();
      const documents = this.database.getConversationDocuments(
        conversation.id,
      );
      const contextualText = buildKnowledgeContext(input.text, documents);
      const prompt = conversation.systemPromptId
        ? this.database.getSystemPrompt(conversation.systemPromptId)
        : this.database.getDefaultSystemPrompt(conversation.provider);
      const providerText = prompt
        ? wrapWithSystemPrompt(contextualText, prompt.content)
        : contextualText;
        await this.runtimes[input.provider].send({
          conversationId: input.conversationId,
          text: providerText,
          attachments: input.attachments,
          modes: input.modes,
          model: input.model,
        });
        if (this.isUnavailableForPersistence()) return;
        const persistedUserMessage = this.database.getMessage(userMessage.id);
        if (persistedUserMessage?.status === "pending") {
          this.database.updateMessage(
          userMessage.id,
          userMessage.content,
          "completed",
          undefined,
          { statusPhase: "completed" },
        );
        }
      } catch (error) {
        if (this.isUnavailableForPersistence()) {
          this.pendingMessageContexts.delete(input.provider);
          throw error;
        }
        const failure = this.describeSendFailure(error);
        this.database.updateMessage(
          userMessage.id,
          userMessage.content,
        "failed",
        undefined,
        failure,
      );
      this.setProviderFailureState(input.provider, {
        phase: failure.statusPhase,
        code: failure.errorCode,
        origin: failure.failureOrigin,
      });
      this.pendingMessageContexts.delete(input.provider);
      this.emitSnapshot();
      throw error;
    }
    this.emitSnapshot();
  }

  async syncWebHistory(provider: ProviderId): Promise<WebHistorySyncResult> {
    return this.startWebHistorySync(provider, true);
  }

  private async startWebHistorySync(
    provider: ProviderId,
    prefetch: boolean,
  ): Promise<WebHistorySyncResult> {
    const existingSync = this.historySyncs.get(provider);
    if (existingSync) return existingSync;
    const operation = (async () => {
      const currentSync = this.currentConversationSyncs.get(provider);
      if (currentSync) {
        await currentSync.catch(() => undefined);
      }
      return this.syncWebHistoryInternal(provider, prefetch);
    })();
    this.historySyncs.set(provider, operation);
    try {
      return await operation;
    } finally {
      this.historySyncs.delete(provider);
    }
  }

  async syncAllWebHistories(): Promise<WebHistorySyncResult[]> {
    const settled = await Promise.allSettled(
      PROVIDER_IDS
        .filter((provider) => this.backendMode(provider) === "web")
        .map((provider) => this.syncWebHistory(provider)),
    );
    return settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  private async syncWebHistoryInternal(
    provider: ProviderId,
    prefetch: boolean,
  ): Promise<WebHistorySyncResult> {
    this.throwIfUnavailableForPersistence();
    if (this.backendMode(provider) !== "web") {
      throw new Error("Website history sync requires the web provider backend.");
    }
    const runtime = this.runtimes[provider];
    await runtime.initialize();
    const state = await runtime.detectState();
    this.throwIfUnavailableForPersistence();
    this.updateProvider(provider, state);
    if (!state.authenticated) {
      throw new Error(
        state.reason ?? `${PROVIDER_LABELS[provider]} is not signed in.`,
      );
    }
    const listSnapshot = await runtime.listWebConversations();
    this.throwIfUnavailableForPersistence();
    const refs = listSnapshot.conversations;
    let created = 0;
    let updated = 0;
    for (const ref of refs.slice(0, 500)) {
      const externalId = normalizeConversationUrl(ref.url);
      if (
        this.database.isWebConversationDeleted(provider, externalId) ||
        this.database.isWebConversationDeleted(provider, ref.url)
      ) {
        continue;
      }
      const existing =
        this.database.getConversationByExternalId(provider, externalId) ??
        this.database.getConversationByExternalId(provider, ref.url);
      if (existing) {
        this.database.updateWebConversation(existing.id, ref.title, externalId);
        updated += 1;
      } else {
        const conversation = this.database.createConversation({
          id: randomUUID(),
          title: ref.title,
          provider,
          externalId,
        });
        this.database.setConversationSyncState(conversation.id, "not-synced");
        created += 1;
      }
    }
    if (!listSnapshot.partial) {
      this.database.markMissingWebConversations(
        provider,
        new Set(refs.map((ref) => normalizeConversationUrl(ref.url))),
      );
    }
    this.emitSnapshot();
    if (prefetch) {
      await this.prefetchWebsiteConversations(
        provider,
        refs,
        this.historySyncGeneration,
      );
    }
    return {
      provider,
      discovered: refs.length,
      created,
      updated,
      partial: listSnapshot.partial,
    };
  }

  private importWebsiteMessages(
    conversation: NormalizedConversation,
    snapshot: WebsiteConversationSnapshot,
  ): string {
    const externalId = normalizeConversationUrl(snapshot.url);
    this.database.updateWebConversation(
      conversation.id,
      snapshot.title || conversation.title,
      externalId,
    );
    for (const message of snapshot.messages) {
      const digest = createHash("sha256")
        .update(`${conversation.provider}:${externalId}:${message.key}`)
        .digest("hex")
        .slice(0, 32);
      this.database.upsertWebsiteMessage({
        id: `web-${digest}`,
        conversationId: conversation.id,
        role: message.role,
        content: message.content,
        providerHtml: message.providerHtml,
        provider: conversation.provider,
        remoteKey: message.key,
        sourceOrder: message.order,
        createdAt: new Date(Date.now() + message.order).toISOString(),
      });
    }
    const syncedAt = new Date().toISOString();
    this.database.setConversationSyncState(
      conversation.id,
      snapshot.partial ? "partial" : "synced",
      { syncedAt },
    );
    return syncedAt;
  }

  private async startAutomaticWebHistorySync(): Promise<void> {
    const generation = ++this.historySyncGeneration;
    const providers = PROVIDER_IDS.filter(
      (provider) => this.backendMode(provider) === "web",
    );
    let nextIndex = 0;
    const worker = async () => {
      while (!this.shuttingDown && generation === this.historySyncGeneration) {
        const provider = providers[nextIndex];
        nextIndex += 1;
        if (!provider) return;
        try {
          await this.startWebHistorySync(provider, true);
        } catch (error) {
          if (!this.shuttingDown) {
            this.database.logAdapterEvent(
              provider,
              "history.sync-failed",
              error instanceof Error ? error.message : String(error),
            );
            this.options.notify?.({
              kind: "sync-failed",
              provider,
              preview: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  private async prefetchWebsiteConversations(
    provider: ProviderId,
    refs: WebsiteConversationRef[],
    generation: number,
  ): Promise<void> {
    const runtime = this.runtimes[provider];
    const originalUrl = (await runtime.getDebugSnapshot().catch(() => undefined))?.url;
    const candidates = [
      ...refs.filter((ref) => ref.isActive),
      ...refs.slice(0, 10),
    ].filter(
      (ref, index, values) =>
        values.findIndex(
          (candidate) =>
            normalizeConversationUrl(candidate.url) ===
            normalizeConversationUrl(ref.url),
        ) === index,
    );

    for (const ref of candidates) {
      if (
        this.shuttingDown ||
        generation !== this.historySyncGeneration ||
        this.states.get(provider)?.websiteVisible
      ) {
        break;
      }
      const externalId = normalizeConversationUrl(ref.url);
      const conversation = this.database.getConversationByExternalId(
        provider,
        externalId,
      );
      if (!conversation) continue;
      this.database.setConversationSyncState(conversation.id, "syncing");
      this.emitSnapshot();
      try {
        this.providerSyncNavigation.add(provider);
        await runtime.navigateToConversation(externalId);
        const snapshot = await runtime.extractCurrentConversation();
        if (this.shuttingDown) return;
        this.importWebsiteMessages(conversation, snapshot);
      } catch (error) {
        if (!this.shuttingDown) {
          this.database.setConversationSyncState(conversation.id, "error", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        this.providerSyncNavigation.delete(provider);
        if (!this.shuttingDown) this.emitSnapshot();
      }
    }

    if (
      originalUrl &&
      !this.shuttingDown &&
      generation === this.historySyncGeneration &&
      !this.states.get(provider)?.websiteVisible
    ) {
      try {
        this.providerSyncNavigation.add(provider);
        await runtime.navigateToConversation(originalUrl);
      } catch {
        // The cached page may no longer be accepted by the provider.
      } finally {
        this.providerSyncNavigation.delete(provider);
      }
    }
  }

  private conversationNeedsRefresh(
    conversation: NormalizedConversation,
  ): boolean {
    if (
      !conversation.lastSyncedAt ||
      conversation.syncStatus === "partial" ||
      conversation.syncStatus === "error" ||
      conversation.syncStatus === "not-synced"
    ) {
      return true;
    }
    return Date.now() - Date.parse(conversation.lastSyncedAt) > 5 * 60_000;
  }

  private scheduleCurrentWebsiteSync(provider: ProviderId): void {
    if (
      this.shuttingDown ||
      this.backendMode(provider) !== "web" ||
      this.providerSyncNavigation.has(provider)
    ) {
      return;
    }
    const currentTimer = this.conversationSyncTimers.get(provider);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
      this.conversationSyncTimers.delete(provider);
      void this.startCurrentWebsiteConversationSync(provider).catch(
        () => undefined,
      );
    }, 900);
    this.conversationSyncTimers.set(provider, timer);
  }

  async syncCurrentWebsiteConversationByWebContents(
    webContents: Electron.WebContents,
  ): Promise<CurrentWebConversationSyncResult> {
    const provider = this.providerForWebContents(webContents);
    if (!provider) {
      throw new Error("The sync request did not come from a managed provider page.");
    }
    this.ensureWebBackend(provider);
    const timer = this.conversationSyncTimers.get(provider);
    if (timer) {
      clearTimeout(timer);
      this.conversationSyncTimers.delete(provider);
    }
    const historySync = this.historySyncs.get(provider);
    if (historySync) {
      await historySync.catch(() => undefined);
    }
    return this.startCurrentWebsiteConversationSync(provider);
  }

  private startCurrentWebsiteConversationSync(
    provider: ProviderId,
  ): Promise<CurrentWebConversationSyncResult> {
    const existingSync = this.currentConversationSyncs.get(provider);
    if (existingSync) return existingSync;
    const operation = this.syncCurrentWebsiteConversation(provider);
    this.currentConversationSyncs.set(provider, operation);
    void operation.finally(() => {
      if (this.currentConversationSyncs.get(provider) === operation) {
        this.currentConversationSyncs.delete(provider);
      }
    }).catch(() => undefined);
    return operation;
  }

  private async syncCurrentWebsiteConversation(
    provider: ProviderId,
  ): Promise<CurrentWebConversationSyncResult> {
    if (
      this.shuttingDown ||
      this.providerSyncNavigation.has(provider) ||
      this.backendMode(provider) !== "web"
    ) {
      throw new Error("The provider page is not ready for current conversation sync.");
    }
    let conversationForError: NormalizedConversation | undefined;
    try {
      this.throwIfUnavailableForPersistence();
      const runtime = this.runtimes[provider];
      await runtime.initialize();
      const state = await runtime.detectState();
      this.updateProvider(provider, state);
      if (!state.authenticated) {
        throw new Error(
          state.reason ?? `${PROVIDER_LABELS[provider]} is not signed in.`,
        );
      }
      const snapshot = await runtime.extractCurrentConversation();
      this.throwIfUnavailableForPersistence();
      if (!isEstablishedWebsiteConversation(provider, snapshot.url)) {
        throw new Error("Open a saved provider conversation before syncing.");
      }
      const externalId = normalizeConversationUrl(snapshot.url);
      if (
        this.database.isWebConversationDeleted(provider, externalId) ||
        this.database.isWebConversationDeleted(provider, snapshot.url)
      ) {
        throw new Error(
          this.uiText(
            "该官网会话位于回收站中。请先恢复，或允许重新导入官网历史。",
            "This website conversation is in Trash. Restore it or allow website history re-import first.",
          ),
        );
      }
      let conversation =
        this.database.getConversationByExternalId(provider, externalId) ??
        this.database.getConversationByExternalId(provider, snapshot.url);
      conversationForError = conversation;
      if (snapshot.messages.length === 0) {
        throw new Error(
          snapshot.fallbackReason
            ? `No conversation messages were found (${snapshot.fallbackReason}).`
            : "No conversation messages were found on the current provider page.",
        );
      }
      let created = false;
      if (!conversation) {
        const activeId = this.activeConversations.get(provider);
        const active = activeId
          ? this.database.getConversation(activeId)
          : undefined;
        if (active && this.canBindWebsiteSnapshot(active, snapshot)) {
          this.database.updateWebConversation(
            active.id,
            snapshot.title || active.title,
            externalId,
          );
          conversation = this.database.getConversation(active.id);
        } else {
          conversation = this.database.createConversation({
            id: randomUUID(),
            title:
              snapshot.title ||
              this.uiText(
                `${PROVIDER_LABELS[provider]} 会话`,
                `${PROVIDER_LABELS[provider]} conversation`,
              ),
            provider,
            externalId,
          });
          created = true;
        }
      }
      if (!conversation) {
        throw new Error("The synchronized conversation could not be persisted.");
      }
      conversationForError = conversation;
      this.database.setConversationSyncState(conversation.id, "syncing");
      this.emitSnapshot();
      const syncedAt = this.importWebsiteMessages(conversation, snapshot);
      if (this.states.get(provider)?.websiteVisible) {
        this.activeConversations.set(provider, conversation.id);
      }
      this.emitSnapshot();
      return {
        provider,
        conversationId: conversation.id,
        created,
        syncedMessages: snapshot.messages.length,
        partial: snapshot.partial,
        syncedAt,
      };
    } catch (error) {
      if (!this.isUnavailableForPersistence()) {
        if (conversationForError) {
          this.database.setConversationSyncState(
            conversationForError.id,
            "error",
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        this.database.logAdapterEvent(
          provider,
          "history.current-sync-failed",
          error instanceof Error ? error.message : String(error),
        );
        this.emitSnapshot();
      }
      throw error;
    }
  }

  private canBindWebsiteSnapshot(
    conversation: NormalizedConversation,
    snapshot: WebsiteConversationSnapshot,
  ): boolean {
    if (conversation.externalId) return false;
    const localUserMessages = conversation.messages
      .filter((message) => message.role === "user")
      .map((message) => normalizeWebsiteSyncText(messageToText(message)))
      .filter(Boolean);
    const remoteUserMessages = snapshot.messages
      .filter((message) => message.role === "user")
      .map((message) =>
        normalizeWebsiteSyncText(contentBlocksToText(message.content))
      )
      .filter(Boolean);
    return localUserMessages.some((localText) =>
      remoteUserMessages.some((remoteText) =>
        localText === remoteText ||
        (
          Math.min(localText.length, remoteText.length) >= 12 &&
          (localText.includes(remoteText) || remoteText.includes(localText))
        ),
      ),
    );
  }

  private async sendManualMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }): Promise<void> {
    const conversation = this.database.getConversation(input.conversationId);
    if (!conversation || conversation.provider !== input.provider) {
      throw new Error(
        this.uiText(
          "该会话不属于所选 Provider。",
          "Conversation does not belong to the selected provider.",
        ),
      );
    }
    if (input.attachments?.length) {
      throw new Error("Manual provider backend does not support attachment automation yet.");
    }
    this.clearProviderFailureState(input.provider);
    this.activeConversations.set(input.provider, input.conversationId);
    const userMessage = {
      ...this.message(input.conversationId, input.provider, "user", input.text),
      content: input.text ? [{ type: "text" as const, text: input.text }] : [],
      status: "pending" as const,
      statusPhase: "checking-auth" as const,
    };
    this.pendingMessageContexts.set(input.provider, {
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
    });
    this.database.addMessage(userMessage);
    this.emitSnapshot();

    try {
      await this.manualClients[input.provider].attach();
      this.manualClients[input.provider].setVisible(true);
      const state = this.states.get(input.provider);
      if (state) state.websiteVisible = true;
      const documents = this.database.getConversationDocuments(conversation.id);
      const contextualText = buildKnowledgeContext(input.text, documents);
      const prompt = conversation.systemPromptId
        ? this.database.getSystemPrompt(conversation.systemPromptId)
        : this.database.getDefaultSystemPrompt(conversation.provider);
      const providerText = prompt
        ? wrapWithSystemPrompt(contextualText, prompt.content)
        : contextualText;
      await this.manualClients[input.provider].composePrompt({
        conversationId: input.conversationId,
        text: providerText,
        modes: input.modes,
        model: input.model,
      });
      const persistedUserMessage = this.database.getMessage(userMessage.id);
      if (persistedUserMessage) {
        this.database.updateMessage(
          userMessage.id,
          persistedUserMessage.content,
          "completed",
          persistedUserMessage.providerHtml,
          {
            statusPhase: "recoverable-blocked",
            statusDetail: "Prompt was filled in the provider page. Review and submit it manually.",
            errorCode: undefined,
          },
        );
      }
      this.updateProvider(input.provider, {
        authenticated: false,
        ready: false,
        degraded: false,
        reason: this.backendUnavailableReason("manual"),
      });
    } catch (error) {
      const persistedUserMessage = this.database.getMessage(userMessage.id);
      if (persistedUserMessage?.status === "pending") {
        const failure = this.describeSendFailure(error);
        this.database.updateMessage(
          userMessage.id,
          persistedUserMessage.content,
          "failed",
          persistedUserMessage.providerHtml,
          failure,
        );
        this.setProviderFailureState(input.provider, {
          phase: failure.statusPhase,
          code: failure.errorCode,
          origin: failure.failureOrigin,
        });
      }
      this.pendingMessageContexts.delete(input.provider);
      throw error;
    } finally {
      this.emitSnapshot();
    }
  }

  private async sendApiMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }): Promise<void> {
    this.throwIfUnavailableForPersistence();
    const conversation = this.database.getConversation(input.conversationId);
    if (!conversation || conversation.provider !== input.provider) {
      throw new Error(
        this.uiText(
          "该会话不属于所选 Provider。",
          "Conversation does not belong to the selected provider.",
        ),
      );
    }
    if (input.attachments?.length) {
      throw new Error("API provider backend does not support attachments yet.");
    }
    this.clearProviderFailureState(input.provider);
    this.activeConversations.set(input.provider, input.conversationId);
    const userMessage = {
      ...this.message(input.conversationId, input.provider, "user", input.text),
      content: input.text ? [{ type: "text" as const, text: input.text }] : [],
      status: "pending" as const,
      statusPhase: "checking-auth" as const,
    };
    this.pendingMessageContexts.set(input.provider, {
      conversationId: input.conversationId,
      userMessageId: userMessage.id,
    });
    this.database.addMessage(userMessage);
    this.emitSnapshot();
    try {
      const documents = this.database.getConversationDocuments(conversation.id);
      const contextualText = buildKnowledgeContext(input.text, documents);
      const prompt = conversation.systemPromptId
        ? this.database.getSystemPrompt(conversation.systemPromptId)
        : this.database.getDefaultSystemPrompt(conversation.provider);
      const providerText = prompt
        ? wrapWithSystemPrompt(contextualText, prompt.content)
        : contextualText;
      await this.apiClients[input.provider].send({
        conversationId: input.conversationId,
        text: providerText,
        modes: input.modes,
        model: input.model,
      });
    } catch (error) {
      const persistedUserMessage = this.database.getMessage(userMessage.id);
      if (persistedUserMessage?.status === "pending") {
        const failure = this.describeSendFailure(error);
        this.database.updateMessage(
          userMessage.id,
          persistedUserMessage.content,
          "failed",
          persistedUserMessage.providerHtml,
          failure,
        );
        this.setProviderFailureState(input.provider, {
          phase: failure.statusPhase,
          code: failure.errorCode,
          origin: failure.failureOrigin,
        });
      }
      this.pendingMessageContexts.delete(input.provider);
      this.emitSnapshot();
      throw error;
    }
    this.emitSnapshot();
  }

  async cancel(provider: ProviderId): Promise<void> {
    this.ensureWebBackend(provider);
    await this.runtimes[provider].cancel();
  }

  async setWebsiteVisible(
    provider: ProviderId,
    visible: boolean,
  ): Promise<void> {
    if (visible) {
      this.historySyncGeneration += 1;
    }
    if (visible && this.backendMode(provider) === "api") {
      this.ensureWebBackend(provider);
    }
    if (visible) {
      try {
        await this.runtimes[provider].initialize();
        if (this.backendMode(provider) === "manual") {
          this.updateProvider(provider, {
            authenticated: false,
            ready: false,
            degraded: false,
            reason: this.backendUnavailableReason("manual"),
          });
        } else {
          const detected = await this.runtimes[provider].recover();
          this.updateProvider(provider, detected);
        }
      } catch (error) {
        this.updateProvider(provider, {
          authenticated: false,
          ready: false,
          degraded: true,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const [id, runtime] of Object.entries(this.runtimes) as [
      ProviderId,
      ProviderClient,
    ][]) {
      runtime.setVisible(id === provider ? visible : false);
      const state = this.states.get(id);
      if (state) state.websiteVisible = id === provider ? visible : false;
    }
    this.setProviderLayout(this.providerDrawerWidth);
    this.emitSnapshot();
  }

  async recoverProvider(provider: ProviderId): Promise<ProviderSummary> {
    this.ensureWebBackend(provider);
    await this.runtimes[provider].initialize();
    const detected = await this.runtimes[provider].recover();
    this.updateProvider(provider, detected);
    this.clearProviderFailureState(provider);
    this.emitSnapshot();
    return this.snapshot().providers.find((entry) => entry.id === provider) ?? {
      id: provider,
      authenticated: detected.authenticated,
      ready: detected.ready,
      degraded: detected.degraded,
      reason: detected.reason,
      websiteVisible: this.states.get(provider)?.websiteVisible ?? false,
    };
  }

  async clearProviderSiteData(provider: ProviderId): Promise<ProviderSummary> {
    await this.setWebsiteVisible(provider, false);
    const state = await this.runtimes[provider].clearSiteData();
    this.updateProvider(provider, state);
    this.clearProviderFailureState(provider);
    this.emitSnapshot();
    return this.snapshot().providers.find((entry) => entry.id === provider) ?? {
      id: provider,
      ...state,
      websiteVisible: false,
    };
  }

  setProviderLayout(width: number): void {
    this.providerDrawerWidth = width;
    Object.values(this.runtimes).forEach((runtime) =>
      runtime.layout(this.providerDrawerWidth),
    );
  }

  hideProviderByWebContents(webContents: Electron.WebContents): void {
    const provider = this.providerForWebContents(webContents);
    if (provider) {
      void this.setWebsiteVisible(provider, false);
    }
  }

  private providerForWebContents(
    webContents: Electron.WebContents,
  ): ProviderId | undefined {
    for (const [id, runtime] of Object.entries(this.runtimes) as [
      ProviderId,
      ProviderClient,
    ][]) {
      if (runtime.ownsWebContents(webContents)) {
        return id;
      }
    }
    return undefined;
  }

  async discoverProviderModels(provider: ProviderId): Promise<void> {
    this.ensureWebBackend(provider);
    await this.runtimes[provider].discoverModels();
  }

  async submitProviderEnter(provider: ProviderId): Promise<void> {
    const mode = this.backendMode(provider);
    if (mode === "api") {
      throw new Error(this.backendUnavailableReason(mode, provider));
    }
    if (mode === "manual") {
      const context = this.pendingMessageContexts.get(provider);
      if (context?.userMessageId) {
        const userMessage = this.database.getMessage(context.userMessageId);
        if (userMessage) {
          this.database.updateMessage(
            context.userMessageId,
            userMessage.content,
            "pending",
            userMessage.providerHtml,
            {
              statusPhase: "submitting",
              statusDetail: "Submitting through the provider page.",
              errorCode: undefined,
            },
          );
        }
      }
      try {
        await this.runtimes[provider].send("");
      } catch (error) {
        if (context?.userMessageId) {
          const userMessage = this.database.getMessage(context.userMessageId);
          if (userMessage) {
            const failure = this.describeSendFailure(error);
            this.database.updateMessage(
              context.userMessageId,
              userMessage.content,
              "failed",
              userMessage.providerHtml,
              failure,
            );
            this.setProviderFailureState(provider, {
              phase: failure.statusPhase,
              code: failure.errorCode,
              origin: failure.failureOrigin,
            });
          }
        }
        this.emitSnapshot();
        throw error;
      }
      this.emitSnapshot();
      return;
    }
    await this.clientForBackend(provider).submitEnter();
  }

  async captureProviderAnchor(provider: ProviderId) {
    return this.clientForBackend(provider).captureAnchor();
  }

  async syncLatestProviderResponse(provider: ProviderId): Promise<boolean> {
    const synced = await this.clientForBackend(provider).syncLatestResponse();
    this.emitSnapshot();
    return synced;
  }

  async getProviderDebugSnapshot(provider: ProviderId) {
    return this.clientForBackend(provider).getDebugSnapshot();
  }

  async getProviderWebsiteSnapshot(
    provider: ProviderId,
  ): Promise<WebsiteConversationSnapshot> {
    this.ensureWebBackend(provider);
    return this.runtimes[provider].extractCurrentConversation();
  }

  async getLatestProviderSmokeResult(
    provider: ProviderId,
  ): Promise<ProviderSmokeTestResult | undefined> {
    return (await this.getProviderSmokeInspection(provider)).result;
  }

  async getProviderSmokeInspection(
    provider: ProviderId,
  ): Promise<ProviderSmokeInspection> {
    const resultPath = path.join(
      this.userDataDir,
      "diagnostics",
      `provider-smoke-${provider}.json`,
    );
    const currentRuntime = await this.getCurrentRuntimeInfo();
    try {
      const raw = (await readFile(resultPath, "utf8")).replace(/^\uFEFF/, "");
      const parsed = providerSmokeTestResultSchema.parse(JSON.parse(raw));
      if (parsed.provider !== provider) {
        return { provider, status: "missing", currentRuntime };
      }
      if (
        currentRuntime?.instanceId &&
        parsed.runtime?.instanceId &&
        parsed.runtime.instanceId !== currentRuntime.instanceId
      ) {
        return {
          provider,
          status: "stale",
          currentRuntime,
          staleRuntimeInstanceId: parsed.runtime.instanceId,
        };
      }
      return {
        provider,
        status: "matched",
        currentRuntime,
        result: parsed,
      };
    } catch {
      return {
        provider,
        status: "missing",
        currentRuntime,
      };
    }
  }

  listProviderAdapterEvents(
    provider: ProviderId,
    limit?: number,
    sinceCreatedAt?: string,
  ): AdapterEventRecord[] {
    return this.database.listAdapterEvents(provider, limit ?? 50, sinceCreatedAt);
  }

  async setProviderCleanMode(provider: ProviderId, enabled: boolean): Promise<void> {
    await this.clientForBackend(provider).setCleanMode(enabled);
  }

  previewTransfer(input: {
    sourceConversationId: string;
    targetProvider: ProviderId;
    compressionProvider?: ProviderId | null;
  }): TransferPreview {
    const conversation = this.requireConversation(input.sourceConversationId);
    if (conversation.provider === input.targetProvider) {
      throw new Error(
        this.uiText(
          "请选择不同的目标 Provider。",
          "Choose a different target provider.",
        ),
      );
    }
    return {
      sourceConversationId: input.sourceConversationId,
      targetProvider: input.targetProvider,
      compressionProvider: input.compressionProvider ?? undefined,
      markdown: buildTransferDraft(conversation),
      messageCount: conversation.messages.length,
    };
  }

  async confirmTransfer(input: {
    sourceConversationId: string;
    targetProvider: ProviderId;
    compressionProvider?: ProviderId | null;
    markdown: string;
  }): Promise<NormalizedConversation> {
    const source = this.requireConversation(input.sourceConversationId);
    if (source.provider === input.targetProvider) {
      throw new Error(
        this.uiText(
          "请选择不同的目标 Provider。",
          "Choose a different target provider.",
        ),
      );
    }
    if (!validateTransferMarkdown(input.markdown)) {
      throw new Error(
        this.uiText(
          "迁移预览缺少必需章节。",
          "Transfer preview does not contain the required sections.",
        ),
      );
    }

    const transferId = randomUUID();
    this.database.createTransfer({
      id: transferId,
      sourceConversationId: input.sourceConversationId,
      targetProvider: input.targetProvider,
      markdown: input.markdown,
    });

    try {
      let transferMarkdown = input.markdown;
      if (input.compressionProvider) {
        const compressor = input.compressionProvider;
        this.ensureWebBackend(compressor);
        await this.runtimes[compressor].createConversation();
        const preparation = this.database.createConversation({
          id: randomUUID(),
          title: this.uiText(
            `迁移准备：${source.title}`,
            `Transfer preparation: ${source.title}`,
          ),
          provider: compressor,
          hidden: true,
        });
      this.activeConversations.set(compressor, preparation.id);
      this.pendingMessageContexts.set(compressor, {
        conversationId: preparation.id,
        userMessageId: "",
      });
        const compressionPrompt = buildCompressionPrompt(input.markdown);
        this.database.addMessage(
          this.message(preparation.id, compressor, "user", compressionPrompt),
        );
        transferMarkdown = await this.runtimes[compressor].sendAndWait(
          compressionPrompt,
        );
        if (!validateTransferMarkdown(transferMarkdown)) {
          throw new Error(
            `${PROVIDER_LABELS[compressor]} returned an invalid transfer document.`,
          );
        }
      }

      this.ensureWebBackend(input.targetProvider);
      await this.runtimes[input.targetProvider].createConversation();
      const target = this.database.createConversation({
        id: randomUUID(),
        title: this.uiText(
          `已迁移：${source.title}`,
          `Transferred: ${source.title}`,
        ),
        provider: input.targetProvider,
      });
      this.activeConversations.set(input.targetProvider, target.id);
      this.pendingMessageContexts.set(input.targetProvider, {
        conversationId: target.id,
        userMessageId: "",
      });
      this.database.addMessage(
        this.message(
          target.id,
          input.targetProvider,
          "user",
          transferMarkdown,
        ),
      );
      await this.runtimes[input.targetProvider].send(transferMarkdown);
      this.database.finishTransfer(transferId, target.id);
      this.emitSnapshot();
      return this.database.getConversation(target.id) ?? target;
    } catch (error) {
      this.database.finishTransfer(
        transferId,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  layout(): void {
    Object.values(this.runtimes).forEach((runtime) =>
      runtime.layout(this.providerDrawerWidth),
    );
  }

  destroy(): void {
    this.shuttingDown = true;
    this.historySyncGeneration += 1;
    this.pendingScheduledBackupRetention = undefined;
    if (this.automaticBackupTimer) {
      clearInterval(this.automaticBackupTimer);
      this.automaticBackupTimer = undefined;
    }
    if (this.trashMaintenanceTimer) {
      clearInterval(this.trashMaintenanceTimer);
      this.trashMaintenanceTimer = undefined;
    }
    for (const timer of this.conversationSyncTimers.values()) {
      clearTimeout(timer);
    }
    this.conversationSyncTimers.clear();
    Object.values(this.runtimes).forEach((runtime) => runtime.destroy());
    Object.values(this.apiClients).forEach((runtime) => runtime.destroy());
  }

  private createRuntime(provider: ProviderId): ProviderClient {
    if (process.env.AIHUB_TEST_MODE === "1") {
      return new MockProviderClient({
        mainWindow: this.window,
        provider,
        onEvent: (id, event) => this.handleProviderEvent(id, event),
      });
    }
    return new ProviderRuntime({
      mainWindow: this.window,
      provider,
      onEvent: (id, event) => this.handleProviderEvent(id, event),
      onVisibilityFallback: (id) => this.showProviderRecoverySurface(id),
    });
  }

  private showProviderRecoverySurface(provider: ProviderId): void {
    for (const [id, runtime] of Object.entries(this.runtimes) as [
      ProviderId,
      ProviderClient,
    ][]) {
      if (id !== provider) runtime.setVisible(false);
      const state = this.states.get(id);
      if (state) state.websiteVisible = id === provider;
    }
    this.setProviderLayout(this.providerDrawerWidth);
    this.emitSnapshot();
  }

  private createApiClient(provider: ProviderId): ProviderClient {
    return new ApiProviderClient(provider, {
      config: () => this.providerApiConfigs[provider],
      apiKey: () => this.apiKeyForProvider(provider),
      onEvent: (id, event) => this.handleProviderEvent(id, event),
    });
  }

  private createManualClient(provider: ProviderId): ProviderClient {
    return new ManualProviderClient(provider, this.runtimes[provider]);
  }

  private applySettings(settings: AppSettingsPayload): void {
    this.providerBackends = settings.providerBackends ?? {};
    this.providerApiConfigs = settings.providerApiConfigs ?? {};
    this.autoSyncWebHistory = settings.autoSyncWebHistory ?? true;
    if (!this.window.isDestroyed()) {
      this.window.webContents.setZoomFactor(settings.uiScale ?? 1);
    }
    for (const provider of PROVIDER_IDS) {
      const backend = this.backendMode(provider);
      if (backend === "web") {
        const current = this.states.get(provider);
        if (current?.reason === this.backendUnavailableReason("api") ||
          current?.reason === this.backendUnavailableReason("api", provider) ||
          current?.reason === this.backendUnavailableReason("manual")) {
          this.updateProvider(provider, {
            authenticated: false,
            ready: false,
            degraded: false,
            reason: undefined,
          });
        }
        continue;
      }
      if (backend === "api") {
        this.updateProvider(provider, this.apiBackendState(provider));
        continue;
      }
      this.updateProvider(provider, {
        authenticated: false,
        ready: false,
        degraded: false,
        reason: this.backendUnavailableReason(backend, provider),
      });
    }
    this.options.onSettingsChanged?.(settings);
  }

  private uiText(zhCN: string, enUS: string): string {
    const locale = this.database.getSettings().locale;
    const useChinese =
      locale === "zh-CN" ||
      (locale !== "en-US" && app.getLocale().toLowerCase().startsWith("zh"));
    return useChinese ? zhCN : enUS;
  }

  private handleAutoSyncSettingChange(wasEnabled: boolean): void {
    if (wasEnabled && !this.autoSyncWebHistory) {
      this.historySyncGeneration += 1;
      return;
    }
    if (
      !wasEnabled &&
      this.autoSyncWebHistory &&
      !this.shuttingDown &&
      this.automaticWebHistorySyncAllowed()
    ) {
      void this.startAutomaticWebHistorySync();
    }
  }

  private automaticWebHistorySyncAllowed(): boolean {
    if (process.env.AIHUB_TEST_MODE === "1") {
      return process.env.AIHUB_TEST_AUTO_SYNC === "1";
    }
    return process.env.NODE_ENV !== "test";
  }

  private backendMode(provider: ProviderId): ProviderBackendMode {
    return this.providerBackends[provider] ?? "web";
  }

  private clientForBackend(provider: ProviderId): ProviderClient {
    const mode = this.backendMode(provider);
    if (mode === "api") return this.apiClients[provider];
    if (mode === "manual") return this.manualClients[provider];
    return this.runtimes[provider];
  }

  private backendUnavailableReason(
    mode: Exclude<ProviderBackendMode, "web">,
    provider?: ProviderId,
  ): string {
    if (mode === "api") {
      const config = provider ? this.providerApiConfigs[provider] : undefined;
      if (!config?.enabled) {
        return "API provider backend is reserved but not configured yet.";
      }
      if (!config.baseUrl || !config.model) {
        return "API provider backend requires a base URL and model.";
      }
      if (provider && !this.apiKeyForProvider(provider)) {
        return `API provider backend requires ${apiKeyEnvName(provider)} or AIHUB_API_KEY.`;
      }
      return "API provider backend is ready.";
    }
    return manualRecoveryReason();
  }

  private apiBackendState(provider: ProviderId): ProviderSummary {
    const reason = this.backendUnavailableReason("api", provider);
    const ready = reason === "API provider backend is ready.";
    return {
      id: provider,
      authenticated: ready,
      ready,
      degraded: !ready,
      reason: ready ? undefined : reason,
      websiteVisible: this.states.get(provider)?.websiteVisible ?? false,
    };
  }

  private apiKeyForProvider(provider: ProviderId): string | undefined {
    return process.env[apiKeyEnvName(provider)] ?? process.env.AIHUB_API_KEY;
  }

  private ensureWebBackend(provider: ProviderId): void {
    const mode = this.backendMode(provider);
    if (mode === "web") return;
    throw new Error(this.backendUnavailableReason(mode, provider));
  }

  private handleProviderEvent(provider: ProviderId, event: ProviderEvent): void {
    if (this.isUnavailableForPersistence()) return;
    this.database.logAdapterEvent(
      provider,
      event.type,
      this.providerEventDetail(event),
    );

    const notificationConversationId =
      this.streamingMessages.get(provider)?.conversationId ??
      this.pendingMessageContexts.get(provider)?.conversationId ??
      this.activeConversations.get(provider);
    if (event.type === "auth.changed") {
      const current = this.states.get(provider);
      this.updateProvider(provider, {
        authenticated: event.authenticated,
        ready: event.authenticated && !current?.degraded,
        degraded: current?.degraded ?? false,
        reason: current?.reason,
      });
    } else if (event.type === "adapter.degraded") {
      this.updateProvider(provider, {
        authenticated: false,
        ready: false,
        degraded: true,
        reason: event.reason,
      });
    } else if (
      event.type === "conversation.changed" ||
      event.type === "conversation.dirty"
    ) {
      this.scheduleCurrentWebsiteSync(provider);
    } else {
      this.persistMessageEvent(provider, event);
    }

    if (event.type === "message.completed") {
      this.options.notify?.({
        kind: "generation-completed",
        provider,
        conversationId: notificationConversationId,
        preview: messageToText(event.message),
      });
    } else if (event.type === "generation.failed") {
      this.options.notify?.({
        kind: "generation-failed",
        provider,
        conversationId: notificationConversationId,
        preview: event.detail,
      });
    }

    this.window.webContents.send("app:provider-event", provider, event);
    this.emitSnapshot();
  }

  private persistMessageEvent(provider: ProviderId, event: ProviderEvent): void {
    if (this.isUnavailableForPersistence()) return;
    const context = this.pendingMessageContexts.get(provider);
    const streaming = this.streamingMessages.get(provider);
    const conversationId =
      context?.conversationId ?? this.activeConversations.get(provider);
    if (!conversationId) return;

    if (event.type === "message.status") {
      if (context?.userMessageId) {
        const message = this.database.getMessage(context.userMessageId);
        if (message?.status === "pending") {
          this.database.updateMessage(
            context.userMessageId,
            message.content,
            "pending",
            message.providerHtml,
            {
              statusPhase: event.phase,
              statusDetail: event.detail,
              errorCode: message.errorCode,
            },
          );
        }
      } else if (
        streaming &&
        (!event.messageId || event.messageId === streaming.providerMessageId)
      ) {
        this.database.updateMessage(
          streaming.messageId,
          streaming.content,
          "streaming",
          streaming.providerHtml,
          {
            statusPhase: event.phase,
            statusDetail: event.detail,
          },
        );
      }
      return;
    }

    if (event.type === "message.started") {
      this.clearProviderFailureState(provider);
      if (context?.userMessageId) {
        const userMessage = this.database.getMessage(context.userMessageId);
        if (userMessage) {
          this.database.updateMessage(
            context.userMessageId,
            userMessage.content,
            "completed",
            userMessage.providerHtml,
            {
              statusPhase: "completed",
              statusDetail: undefined,
              errorCode: undefined,
            },
          );
        }
      }
      const messageId = randomUUID();
      this.streamingMessages.set(provider, {
        messageId,
        providerMessageId: event.messageId,
        conversationId,
        text: "",
        content: [{ type: "text", text: "" }],
        sequence: 0,
      });
      this.pendingMessageContexts.delete(provider);
      this.database.addMessage({
        ...this.message(conversationId, provider, "assistant", ""),
        id: messageId,
        status: "streaming",
        statusPhase: "waiting-first-token",
      });
    }

    if (event.type === "generation.failed" && !streaming && context?.userMessageId) {
      if (event.messageId) return;
      this.setProviderFailureState(provider, {
        phase: event.phase ?? "failed",
        code: event.code,
        origin: this.failureOriginForGeneration(event.code, event.detail),
      });
      const userMessage = this.database.getMessage(context.userMessageId);
      if (userMessage) {
        this.database.updateMessage(
          context.userMessageId,
          userMessage.content,
          "failed",
          userMessage.providerHtml,
          {
            statusPhase: event.phase ?? "failed",
            statusDetail: event.detail,
            errorCode: event.code,
            failureOrigin: this.failureOriginForGeneration(event.code, event.detail),
          },
        );
      }
      this.pendingMessageContexts.delete(provider);
      return;
    }

    if (!streaming) return;

    if (event.type === "message.delta") {
      if (event.messageId !== streaming.providerMessageId) return;
      streaming.text += event.text;
      streaming.content = updateStreamingContent(streaming.content, streaming.text);
      streaming.sequence += 1;
      this.database.addFragment(
        streaming.messageId,
        streaming.sequence,
        event.text,
      );
      this.database.updateMessage(
        streaming.messageId,
        streaming.content,
        "streaming",
        streaming.providerHtml,
        {
          statusPhase: "streaming",
        },
      );
    } else if (event.type === "message.snapshot") {
      if (event.messageId !== streaming.providerMessageId) return;
      streaming.text = event.text || streaming.text;
      streaming.content = event.content;
      if (event.providerHtml) streaming.providerHtml = event.providerHtml;
      this.database.updateMessage(
        streaming.messageId,
        streaming.content,
        "streaming",
        streaming.providerHtml,
        {
          statusPhase: event.phase ?? "streaming",
          statusDetail: event.detail,
        },
      );
    } else if (event.type === "message.completed") {
      if (event.message.id !== streaming.providerMessageId) return;
      this.clearProviderFailureState(provider);
      const finalText = messageToText(event.message);
      this.database.updateMessage(
        streaming.messageId,
        event.message.content.length > 0
          ? event.message.content
          : updateStreamingContent(streaming.content, finalText || streaming.text),
        "completed",
        event.message.providerHtml,
        {
          statusPhase: "completed",
        },
      );
      this.streamingMessages.delete(provider);
    } else if (event.type === "generation.failed") {
      if (event.messageId && event.messageId !== streaming.providerMessageId) return;
      this.setProviderFailureState(provider, {
        phase: event.phase ?? "failed",
        code: event.code,
        origin: this.failureOriginForGeneration(event.code, event.detail),
      });
      this.database.updateMessage(
        streaming.messageId,
        updateStreamingContent(streaming.content, streaming.text),
        "failed",
        streaming.providerHtml,
        {
          statusPhase: event.phase ?? "failed",
          statusDetail: event.detail,
          errorCode: event.code,
          failureOrigin: this.failureOriginForGeneration(event.code, event.detail),
        },
      );
      this.streamingMessages.delete(provider);
    }
  }

  private providerEventDetail(event: ProviderEvent): string | undefined {
    switch (event.type) {
      case "auth.changed":
        return JSON.stringify({ authenticated: event.authenticated });
      case "conversation.changed":
        return JSON.stringify({ externalId: event.externalId });
      case "conversation.dirty":
        return JSON.stringify({ externalId: event.externalId });
      case "message.anchor-captured":
        return JSON.stringify({
          messageId: event.messageId,
          detail: event.detail,
        });
      case "message.assistant-bound":
        return JSON.stringify({
          messageId: event.messageId,
          detail: event.detail,
        });
      case "message.started":
        return JSON.stringify({ messageId: event.messageId });
      case "message.delta":
        return JSON.stringify({
          messageId: event.messageId,
          textLength: event.text.length,
        });
      case "message.status":
        return JSON.stringify({
          messageId: event.messageId,
          phase: event.phase,
          detail: event.detail,
        });
      case "message.snapshot":
        return JSON.stringify({
          messageId: event.messageId,
          textLength: event.text.length,
          contentBlocks: event.content.length,
          providerHtmlLength: event.providerHtml?.length ?? 0,
          phase: event.phase,
          detail: event.detail,
        });
      case "message.completed":
        return JSON.stringify({
          messageId: event.message.id,
          role: event.message.role,
          status: event.message.status,
          statusPhase: event.message.statusPhase,
          contentBlocks: event.message.content.length,
          textLength: messageToText(event.message).length,
          providerHtmlLength: event.message.providerHtml?.length ?? 0,
        });
      case "generation.failed":
        return JSON.stringify({
          messageId: event.messageId,
          code: event.code,
          recoverable: event.recoverable,
          phase: event.phase,
          detail: event.detail,
        });
      case "capabilities.changed":
        return JSON.stringify({
          attachmentKinds: event.capabilities.attachments.length,
          modes: event.capabilities.modes.length,
          model: event.capabilities.model,
          models: event.capabilities.models.length,
          multipleAttachments: event.capabilities.multipleAttachments,
          acceptedTypes: event.capabilities.acceptedTypes.length,
        });
      case "provider.network-started":
      case "provider.network-idle":
        return JSON.stringify({ url: event.url });
      case "provider.transport":
        return JSON.stringify(event.event);
      case "provider.debug-snapshot":
        return JSON.stringify(event.snapshot);
      case "adapter.degraded":
        return event.reason;
    }
  }

  private updateProvider(
    provider: ProviderId,
    state: {
      authenticated: boolean;
      ready: boolean;
      degraded: boolean;
      reason?: string;
    },
  ): void {
    if (this.isUnavailableForPersistence()) return;
    const current = this.states.get(provider);
    this.states.set(provider, {
      id: provider,
      ...state,
      lastFailurePhase: current?.lastFailurePhase,
      lastFailureCode: current?.lastFailureCode,
      lastFailureOrigin: current?.lastFailureOrigin,
      websiteVisible: current?.websiteVisible ?? false,
    });
    this.database.upsertProvider(provider, state);
  }

  private setProviderFailureState(
    provider: ProviderId,
    failure: {
      phase?: ProviderSendPhase;
      code?: string;
      origin?: ProviderFailureOrigin;
    },
  ): void {
    const current = this.states.get(provider);
    if (!current) return;
    this.states.set(provider, {
      ...current,
      lastFailurePhase: failure.phase,
      lastFailureCode: failure.code,
      lastFailureOrigin: failure.origin,
    });
  }

  private clearProviderFailureState(provider: ProviderId): void {
    this.setProviderFailureState(provider, {
      phase: undefined,
      code: undefined,
      origin: undefined,
    });
  }

  private emitSnapshot(): void {
    if (this.isUnavailableForPersistence()) return;
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("app:snapshot", appSnapshotSchema.parse(this.snapshot()));
    }
  }

  private async getCurrentRuntimeInfo(): Promise<{
    instanceId: string;
    pid: number;
    startedAt: string;
  } | undefined> {
    const runtimeInfoPath = path.join(
      this.userDataDir,
      "diagnostics",
      "runtime-info.json",
    );
    try {
      const raw = (await readFile(runtimeInfoPath, "utf8")).replace(/^\uFEFF/, "");
      return providerSmokeRuntimeInfoSchema.parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  private message(
    conversationId: string,
    provider: ProviderId,
    role: NormalizedMessage["role"],
    text: string,
  ): NormalizedMessage {
    return {
      id: randomUUID(),
      conversationId,
      role,
      content: [{ type: "text", text }],
      status: "completed",
      provider,
      createdAt: new Date().toISOString(),
    };
  }

  private describeSendFailure(
    error: unknown,
  ): Pick<
    NormalizedMessage,
    "statusPhase" | "statusDetail" | "errorCode" | "failureOrigin"
  > {
    const detail = error instanceof Error ? error.message : String(error);
    if (/login|verification|auth/i.test(detail)) {
      return {
        statusPhase: "checking-auth",
        statusDetail: detail,
        errorCode: "auth_required",
        failureOrigin: "auth",
      };
    }
    if (/provider composer is not ready yet/i.test(detail)) {
      return {
        statusPhase: "checking-auth",
        statusDetail: detail,
        errorCode: "auth_required",
        failureOrigin: "auth",
      };
    }
    if (/cancelled|canceled|aborted by user/i.test(detail)) {
      return {
        statusPhase: "failed",
        statusDetail: detail,
        errorCode: "cancelled_by_user",
        failureOrigin: "cancelled",
      };
    }
    if (
      /\b429\b|\b5\d\d\b|rate.?limit|too many requests|network (?:error|failure)|ERR_(?:NETWORK|CONNECTION|TIMED_OUT)/i.test(
        detail,
      )
    ) {
      return {
        statusPhase: "failed",
        statusDetail: detail,
        errorCode: "provider_external_failure",
        failureOrigin: "external",
      };
    }
    if (/timed out/i.test(detail)) {
      return {
        statusPhase: "submitting",
        statusDetail: detail,
        errorCode: "provider_submission_timeout",
        failureOrigin: "client",
      };
    }
    if (/Submission detection failed|submit_not_confirmed|submission.*not.*confirm/i.test(detail)) {
      return {
        statusPhase: "confirming-submit",
        statusDetail: detail,
        errorCode: "provider_submit_not_confirmed",
        failureOrigin: "client",
      };
    }
    if (/Composer not found|Text entry failed|Text not in composer|compose/i.test(detail)) {
      return {
        statusPhase: "typing-message",
        statusDetail: detail,
        errorCode: /Composer not found/i.test(detail)
          ? "provider_composer_not_found"
          : "provider_compose_failed",
        failureOrigin: "client",
      };
    }
    if (/Provider send button not found/i.test(detail)) {
      return {
        statusPhase: "submitting",
        statusDetail: detail,
        errorCode: "provider_submit_not_found",
        failureOrigin: "client",
      };
    }
    if (/Submit action failed/i.test(detail)) {
      return {
        statusPhase: "submitting",
        statusDetail: detail,
        errorCode: "provider_submit_failed",
        failureOrigin: "client",
      };
    }
    const failed: ProviderSendPhase = "failed";
    return {
      statusPhase: failed,
      statusDetail: detail,
      errorCode: "provider_send_failed",
      failureOrigin: "client",
    };
  }

  private failureOriginForGeneration(
    code: string,
    detail?: string,
  ): ProviderFailureOrigin {
    const evidence = `${code} ${detail ?? ""}`;
    if (/auth|login|verification|captcha|扫码|验证码|安全验证/i.test(evidence)) {
      return "auth";
    }
    if (/cancelled|canceled|aborted_by_user/i.test(evidence)) {
      return "cancelled";
    }
    if (
      /\b429\b|\b5\d\d\b|rate.?limit|too many|network|ERR_|provider_(?:external|http)/i.test(
        evidence,
      )
    ) {
      return "external";
    }
    return "client";
  }

  private requireConversation(conversationId: string): NormalizedConversation {
    const conversation = this.database.getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation was not found.");
    }
    return conversation;
  }

  private isUnavailableForPersistence(): boolean {
    return this.shuttingDown || this.database.isClosed();
  }

  private throwIfUnavailableForPersistence(): void {
    if (this.isUnavailableForPersistence()) {
      throw new Error("Application is closing.");
    }
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }
  return pages.join("\n\n");
}

function mimeTypeForExtension(extension: string): string {
  const types: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
  };
  return types[extension] ?? "application/octet-stream";
}

function sanitizeConversationForExport(
  conversation: NormalizedConversation,
): NormalizedConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      const interrupted =
        message.status === "pending" || message.status === "streaming";
      return {
        ...message,
        providerHtml: undefined,
        ...(interrupted
          ? {
              status: "failed" as const,
              statusPhase: "failed" as const,
              statusDetail: undefined,
              errorCode: "exported_incomplete_message",
              failureOrigin: "client" as const,
            }
          : {}),
        content: message.content.flatMap((block): ContentBlock[] => {
          if (block.type === "attachment") {
            return [
              {
                type: "attachment",
                name: containsLocalPath(block.name)
                  ? path.win32.basename(block.name)
                  : block.name,
              },
            ];
          }
          if (block.type === "image" && containsLocalPath(block.src)) {
            return [];
          }
          if (block.type === "citation" && containsLocalPath(block.url)) {
            return [];
          }
          if (block.type === "html" && containsLocalPath(block.html)) {
            return [];
          }
          return [block];
        }),
      };
    }),
  };
}

function containsLocalPath(value: string): boolean {
  return /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(value);
}

function updateStreamingContent(
  content: ContentBlock[],
  text: string,
): ContentBlock[] {
  const remainder = content.filter((block) => block.type !== "text");
  return [{ type: "text", text }, ...remainder];
}

function normalizeConversationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|share$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function isEstablishedWebsiteConversation(
  provider: ProviderId,
  url: string,
): boolean {
  const pattern = providerDefinitions[provider].conversationUrlPattern;
  if (!pattern) return false;
  return new RegExp(pattern.source, pattern.flags).test(url);
}

function normalizeWebsiteSyncText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
