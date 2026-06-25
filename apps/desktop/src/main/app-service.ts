import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildKnowledgeContext,
  appSettingsSchema,
  buildCompressionPrompt,
  buildTransferDraft,
  normalizedConversationSchema,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  validateTransferMarkdown,
  wrapWithSystemPrompt,
  type AppSnapshot,
  type AppSettingsPayload,
  type ComparisonSession,
  type ConversationFolder,
  type ConversationTag,
  type KnowledgeDocument,
  type NormalizedConversation,
  type NormalizedMessage,
  type ProviderEvent,
  type ProviderId,
  type OutgoingAttachment,
  type ProviderMode,
  type ProviderSummary,
  type SystemPrompt,
  type TransferPreview,
} from "@aihub/core";
import { dialog, shell, type BrowserWindow } from "electron";
import { AppDatabase } from "./database";
import { ProviderRuntime } from "./provider-runtime";

export class AppService {
  private readonly runtimes: Record<ProviderId, ProviderRuntime>;
  private readonly states = new Map<ProviderId, ProviderSummary>();
  private readonly activeConversations = new Map<ProviderId, string>();
  private readonly streamingMessages = new Map<
    ProviderId,
    {
      messageId: string;
      conversationId: string;
      text: string;
      sequence: number;
      providerHtml?: string;
    }
  >();
  private providerDrawerWidth = 520;

  constructor(
    private readonly window: BrowserWindow,
    private readonly database: AppDatabase,
  ) {
    this.runtimes = Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, this.createRuntime(id)]),
    ) as Record<ProviderId, ProviderRuntime>;
    for (const id of PROVIDER_IDS) {
      this.states.set(id, {
        id,
        authenticated: false,
        ready: false,
        degraded: false,
        websiteVisible: false,
      });
    }
  }

  async initialize(): Promise<void> {
    this.emitSnapshot();
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
    if (!existing) throw new Error("System prompt was not found.");
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
      throw new Error("System prompt was not found.");
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
      if (!prompt) throw new Error("System prompt was not found.");
      if (prompt.provider && prompt.provider !== conversation.provider) {
        throw new Error("System prompt does not support this provider.");
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
      title: "添加到本地知识库",
      properties: ["openFile"],
      filters: [
        {
          name: "Supported documents",
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
      throw new Error("One or more knowledge documents were not found.");
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
      throw new Error("Parent folder was not found.");
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
      throw new Error("One or more tags were not found.");
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
        message.content
          .map((block) => {
            if (block.type === "text") return block.text;
            if (block.type === "code") {
              return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n\n"),
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
    return appSettingsSchema.parse(this.database.getSettings());
  }

  setSettings(settings: AppSettingsPayload): void {
    this.database.setSettings(appSettingsSchema.parse(settings));
  }

  exportSettings(): string {
    return JSON.stringify(this.getSettings(), null, 2);
  }

  importSettings(json: string): AppSettingsPayload {
    const settings = appSettingsSchema.parse(JSON.parse(json));
    this.database.setSettings(settings);
    return settings;
  }

  async openExternal(url: string): Promise<void> {
    await shell.openExternal(url);
  }

  async createComparison(
    providers: ProviderId[],
  ): Promise<ComparisonSession> {
    const participants: ComparisonSession["participants"] = [];
    for (const provider of providers) {
      await this.runtimes[provider].createConversation();
      const conversation = this.database.createConversation({
        id: randomUUID(),
        title: `Comparison: ${PROVIDER_LABELS[provider]}`,
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
      title: `Compare ${providers.map((provider) => PROVIDER_LABELS[provider]).join(" / ")}`,
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
    if (!session) throw new Error("Comparison session was not found.");
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
      throw new Error("Message was not found in this conversation.");
    }
    if (message.status === "streaming") {
      throw new Error("Stop generation before deleting this message.");
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
      throw new Error("Only user messages can be edited and resent.");
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
    await this.runtimes[provider].createConversation();
    const conversation = this.database.createConversation({
      id: randomUUID(),
      title: `New ${PROVIDER_LABELS[provider]} conversation`,
      provider,
    });
    this.activeConversations.set(provider, conversation.id);
    this.emitSnapshot();
    return conversation;
  }

  async sendMessage(input: {
    provider: ProviderId;
    conversationId: string;
    text: string;
    attachments?: OutgoingAttachment[];
    modes?: ProviderMode[];
    model?: string;
  }): Promise<void> {
    const conversation = this.database.getConversation(input.conversationId);
    if (!conversation || conversation.provider !== input.provider) {
      throw new Error("Conversation does not belong to the selected provider.");
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
    };
    this.database.addMessage(userMessage);
    this.emitSnapshot();
    try {
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
      this.database.updateMessage(
        userMessage.id,
        userMessage.content,
        "completed",
      );
    } catch (error) {
      this.database.updateMessage(
        userMessage.id,
        userMessage.content,
        "failed",
      );
      this.emitSnapshot();
      throw error;
    }
    this.emitSnapshot();
  }

  async cancel(provider: ProviderId): Promise<void> {
    await this.runtimes[provider].cancel();
  }

  async setWebsiteVisible(
    provider: ProviderId,
    visible: boolean,
  ): Promise<void> {
    if (visible) {
      try {
        await this.runtimes[provider].initialize();
        const detected = await this.runtimes[provider].detectState();
        this.updateProvider(provider, detected);
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
      ProviderRuntime,
    ][]) {
      runtime.setVisible(id === provider ? visible : false);
      const state = this.states.get(id);
      if (state) state.websiteVisible = id === provider ? visible : false;
    }
    this.setProviderLayout(this.providerDrawerWidth);
    this.emitSnapshot();
  }

  setProviderLayout(width: number): void {
    this.providerDrawerWidth = width;
    Object.values(this.runtimes).forEach((runtime) =>
      runtime.layout(this.providerDrawerWidth),
    );
  }

  async discoverProviderModels(provider: ProviderId): Promise<void> {
    await this.runtimes[provider].discoverModels();
  }

  previewTransfer(input: {
    sourceConversationId: string;
    targetProvider: ProviderId;
    compressionProvider?: ProviderId | null;
  }): TransferPreview {
    const conversation = this.requireConversation(input.sourceConversationId);
    if (conversation.provider === input.targetProvider) {
      throw new Error("Choose a different target provider.");
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
      throw new Error("Choose a different target provider.");
    }
    if (!validateTransferMarkdown(input.markdown)) {
      throw new Error("Transfer preview does not contain the required sections.");
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
        await this.runtimes[compressor].createConversation();
        const preparation = this.database.createConversation({
          id: randomUUID(),
          title: `Transfer preparation: ${source.title}`,
          provider: compressor,
          hidden: true,
        });
        this.activeConversations.set(compressor, preparation.id);
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

      await this.runtimes[input.targetProvider].createConversation();
      const target = this.database.createConversation({
        id: randomUUID(),
        title: `Transferred: ${source.title}`,
        provider: input.targetProvider,
      });
      this.activeConversations.set(input.targetProvider, target.id);
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
    Object.values(this.runtimes).forEach((runtime) => runtime.destroy());
  }

  private createRuntime(provider: ProviderId): ProviderRuntime {
    return new ProviderRuntime({
      mainWindow: this.window,
      provider,
      onEvent: (id, event) => this.handleProviderEvent(id, event),
    });
  }

  private handleProviderEvent(provider: ProviderId, event: ProviderEvent): void {
    this.database.logAdapterEvent(
      provider,
      event.type,
      "reason" in event ? event.reason : undefined,
    );

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
    } else {
      this.persistMessageEvent(provider, event);
    }

    this.window.webContents.send("app:provider-event", provider, event);
    this.emitSnapshot();
  }

  private persistMessageEvent(provider: ProviderId, event: ProviderEvent): void {
    const conversationId = this.activeConversations.get(provider);
    if (!conversationId) return;

    if (event.type === "message.started") {
      const messageId = randomUUID();
      this.streamingMessages.set(provider, {
        messageId,
        conversationId,
        text: "",
        sequence: 0,
      });
      this.database.addMessage({
        ...this.message(conversationId, provider, "assistant", ""),
        id: messageId,
        status: "streaming",
      });
    }

    const streaming = this.streamingMessages.get(provider);
    if (!streaming) return;

    if (event.type === "message.delta") {
      streaming.text += event.text;
      streaming.sequence += 1;
      this.database.addFragment(
        streaming.messageId,
        streaming.sequence,
        event.text,
      );
      this.database.updateMessage(
        streaming.messageId,
        [{ type: "text", text: streaming.text }],
        "streaming",
        streaming.providerHtml,
      );
    } else if (event.type === "message.snapshot") {
      streaming.text = event.text || streaming.text;
      if (event.providerHtml) streaming.providerHtml = event.providerHtml;
      this.database.updateMessage(
        streaming.messageId,
        [{ type: "text", text: streaming.text }],
        "streaming",
        streaming.providerHtml,
      );
    } else if (event.type === "message.completed") {
      const finalText = event.message.content
        .filter((block) => block.type === "text" || block.type === "code")
        .map((block) => ("text" in block ? block.text : ""))
        .join("\n");
      this.database.updateMessage(
        streaming.messageId,
        [{ type: "text", text: finalText || streaming.text }],
        "completed",
        event.message.providerHtml,
      );
      this.streamingMessages.delete(provider);
    } else if (event.type === "generation.failed") {
      this.database.updateMessage(
        streaming.messageId,
        [{ type: "text", text: streaming.text }],
        "failed",
      );
      this.streamingMessages.delete(provider);
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
    const current = this.states.get(provider);
    this.states.set(provider, {
      id: provider,
      ...state,
      websiteVisible: current?.websiteVisible ?? false,
    });
    this.database.upsertProvider(provider, state);
  }

  private emitSnapshot(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("app:snapshot", this.snapshot());
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

  private requireConversation(conversationId: string): NormalizedConversation {
    const conversation = this.database.getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation was not found.");
    }
    return conversation;
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
