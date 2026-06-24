import { randomUUID } from "node:crypto";
import {
  buildCompressionPrompt,
  buildTransferDraft,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  validateTransferMarkdown,
  type AppSnapshot,
  type NormalizedConversation,
  type NormalizedMessage,
  type ProviderEvent,
  type ProviderId,
  type ProviderSummary,
  type TransferPreview,
} from "@aihub/core";
import type { BrowserWindow } from "electron";
import { AppDatabase } from "./database";
import { ProviderRuntime } from "./provider-runtime";

export class AppService {
  private readonly runtimes: Record<ProviderId, ProviderRuntime>;
  private readonly states = new Map<ProviderId, ProviderSummary>();
  private readonly activeConversations = new Map<ProviderId, string>();
  private readonly streamingMessages = new Map<
    ProviderId,
    { messageId: string; conversationId: string; text: string; sequence: number }
  >();

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
    };
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
  }): Promise<void> {
    const conversation = this.database.getConversation(input.conversationId);
    if (!conversation || conversation.provider !== input.provider) {
      throw new Error("Conversation does not belong to the selected provider.");
    }
    this.activeConversations.set(input.provider, input.conversationId);
    const userMessage = {
      ...this.message(
        input.conversationId,
        input.provider,
        "user",
        input.text,
      ),
      status: "pending" as const,
    };
    this.database.addMessage(userMessage);
    this.emitSnapshot();
    try {
      await this.runtimes[input.provider].send(input.text);
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
    this.emitSnapshot();
  }

  previewTransfer(sourceConversationId: string): TransferPreview {
    const conversation = this.database.getConversation(sourceConversationId);
    if (!conversation || conversation.provider !== "chatgpt") {
      throw new Error("Only ChatGPT conversations can be transferred in v1.");
    }
    return {
      sourceConversationId,
      targetProvider: "claude",
      markdown: buildTransferDraft(conversation),
      messageCount: conversation.messages.length,
    };
  }

  async confirmTransfer(input: {
    sourceConversationId: string;
    markdown: string;
  }): Promise<NormalizedConversation> {
    const source = this.database.getConversation(input.sourceConversationId);
    if (!source || source.provider !== "chatgpt") {
      throw new Error("The source ChatGPT conversation was not found.");
    }
    if (!validateTransferMarkdown(input.markdown)) {
      throw new Error("Transfer preview does not contain the required sections.");
    }

    const transferId = randomUUID();
    this.database.createTransfer({
      id: transferId,
      sourceConversationId: input.sourceConversationId,
      markdown: input.markdown,
    });

    try {
      await this.runtimes.claude.createConversation();
      const preparation = this.database.createConversation({
        id: randomUUID(),
        title: `Transfer preparation: ${source.title}`,
        provider: "claude",
        hidden: true,
      });
      this.activeConversations.set("claude", preparation.id);
      const compressionPrompt = buildCompressionPrompt(input.markdown);
      this.database.addMessage(
        this.message(preparation.id, "claude", "user", compressionPrompt),
      );
      const compressed = await this.runtimes.claude.sendAndWait(
        compressionPrompt,
      );
      if (!validateTransferMarkdown(compressed)) {
        throw new Error("Claude returned an invalid transfer document.");
      }

      await this.runtimes.claude.createConversation();
      const target = this.database.createConversation({
        id: randomUUID(),
        title: `Transferred: ${source.title}`,
        provider: "claude",
      });
      this.activeConversations.set("claude", target.id);
      this.database.addMessage(
        this.message(target.id, "claude", "user", compressed),
      );
      await this.runtimes.claude.send(compressed);
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
    Object.values(this.runtimes).forEach((runtime) => runtime.layout());
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
}
