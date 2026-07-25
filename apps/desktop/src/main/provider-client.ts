import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  NormalizedMessage,
  OutgoingMessage,
  ProviderApiConfig,
  ProviderConversationAnchor,
  ProviderDebugSnapshot,
  ProviderEvent,
  ProviderId,
  ProviderState,
  WebsiteConversationListSnapshot,
  WebsiteConversationSnapshot,
} from "@aihub/core";

export interface ProviderClient {
  readonly id: ProviderId;
  initialize(): Promise<void>;
  attach(): Promise<void>;
  detectState(): Promise<ProviderState>;
  createConversation(): Promise<void>;
  navigateToConversation(url: string): Promise<void>;
  sendAndWait(text: string, timeoutMs?: number): Promise<string>;
  send(input: string | OutgoingMessage): Promise<void>;
  composePrompt(input: string | OutgoingMessage): Promise<void>;
  cancel(): Promise<void>;
  discoverModels(): Promise<void>;
  submitEnter(): Promise<void>;
  captureAnchor(): Promise<ProviderConversationAnchor>;
  recover(): Promise<ProviderState>;
  syncLatestResponse(): Promise<boolean>;
  listWebConversations(): Promise<WebsiteConversationListSnapshot>;
  extractCurrentConversation(): Promise<WebsiteConversationSnapshot>;
  getDebugSnapshot(): Promise<ProviderDebugSnapshot>;
  setCleanMode(enabled: boolean): Promise<void>;
  clearSiteData(): Promise<ProviderState>;
  checkCompletion(): Promise<void>;
  setVisible(visible: boolean): void;
  layout(drawerWidth?: number): void;
  isVisible(): boolean;
  ownsWebContents(webContents: WebContents): boolean;
  destroy(): void;
}

abstract class UnavailableProviderClient implements ProviderClient {
  readonly id: ProviderId;
  private visible = false;

  constructor(provider: ProviderId) {
    this.id = provider;
  }

  async initialize(): Promise<void> {}

  async attach(): Promise<void> {}

  async detectState(): Promise<ProviderState> {
    return {
      authenticated: false,
      ready: false,
      degraded: this.degraded,
      reason: this.reason,
    };
  }

  async createConversation(): Promise<void> {
    throw new Error(this.reason);
  }

  async navigateToConversation(): Promise<void> {
    throw new Error(this.reason);
  }

  async sendAndWait(): Promise<string> {
    throw new Error(this.reason);
  }

  async send(): Promise<void> {
    throw new Error(this.reason);
  }

  async composePrompt(): Promise<void> {
    throw new Error(this.reason);
  }

  async cancel(): Promise<void> {}

  async discoverModels(): Promise<void> {
    throw new Error(this.reason);
  }

  async submitEnter(): Promise<void> {
    throw new Error(this.reason);
  }

  async captureAnchor(): Promise<ProviderConversationAnchor> {
    return {
      sequence: 0,
      textSignature: "",
      elementSignature: "unavailable",
    };
  }

  async recover(): Promise<ProviderState> {
    return this.detectState();
  }

  async syncLatestResponse(): Promise<boolean> {
    return false;
  }

  async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
    return {
      conversations: [],
      scanRounds: 0,
      partial: true,
      fallbackReason: this.reason,
    };
  }

  async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
    throw new Error(this.reason);
  }

  async getDebugSnapshot(): Promise<ProviderDebugSnapshot> {
    return {
      provider: this.id,
      url: "unavailable",
      composer: "unavailable",
      submit: "unavailable",
      anchor: "unavailable",
      assistant: "unavailable",
      activeMessageId: undefined,
      assistantBinding: "unavailable",
      latestTextLength: 0,
      isGenerating: false,
      networkActiveCount: 0,
      networkIdle: true,
      lastNetworkUrl: undefined,
      lastMutationAt: 0,
      completionDecision: this.reason,
      completionSignals: inactiveCompletionSignals(),
      fallbackUsed: false,
    };
  }

  async setCleanMode(): Promise<void> {}

  async clearSiteData(): Promise<ProviderState> {
    return this.detectState();
  }

  async checkCompletion(): Promise<void> {}

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  layout(): void {}

  isVisible(): boolean {
    return this.visible;
  }

  ownsWebContents(_webContents: WebContents): boolean {
    return false;
  }

  destroy(): void {}

  protected abstract readonly reason: string;
  protected abstract readonly degraded: boolean;
}

const chatCompletionResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.union([
        z.string(),
        z.array(z.object({
          type: z.string(),
          text: z.string().optional(),
        })),
      ]).optional(),
    }).optional(),
  })).min(1),
});

export class ApiProviderClient implements ProviderClient {
  readonly id: ProviderId;
  private visible = false;

  constructor(
    provider: ProviderId,
    private readonly options: {
      config: () => ProviderApiConfig | undefined;
      apiKey: () => string | undefined;
      onEvent: (provider: ProviderId, event: ProviderEvent) => void;
    },
  ) {
    this.id = provider;
  }

  async initialize(): Promise<void> {}

  async attach(): Promise<void> {}

  async detectState(): Promise<ProviderState> {
    const readiness = this.readiness();
    return {
      authenticated: readiness.ready,
      ready: readiness.ready,
      degraded: !readiness.ready,
      reason: readiness.ready ? undefined : readiness.reason,
    };
  }

  async createConversation(): Promise<void> {}

  async navigateToConversation(): Promise<void> {}

  async sendAndWait(text: string): Promise<string> {
    return this.complete(text);
  }

  async send(input: string | OutgoingMessage): Promise<void> {
    const request = typeof input === "string"
      ? { conversationId: "", text: input }
      : input;
    const messageId = randomUUID();
    this.options.onEvent(this.id, { type: "message.started", messageId });
    let text: string;
    try {
      text = await this.complete(request.text, request.model);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.onEvent(this.id, {
        type: "generation.failed",
        messageId,
        code: "provider_api_request_failed",
        recoverable: true,
        phase: "failed",
        detail,
      });
      throw error;
    }
    const message: NormalizedMessage = {
      id: messageId,
      conversationId: request.conversationId || "__api_provider__",
      role: "assistant",
      content: [{ type: "text", text }],
      status: "completed",
      statusPhase: "completed",
      provider: this.id,
      createdAt: new Date().toISOString(),
    };
    this.options.onEvent(this.id, {
      type: "message.snapshot",
      messageId,
      content: message.content,
      text,
      phase: "streaming",
      detail: "Received from configured API backend.",
    });
    this.options.onEvent(this.id, { type: "message.completed", message });
  }

  async composePrompt(): Promise<void> {
    throw new Error("API provider backend does not support manual composer fill.");
  }

  async cancel(): Promise<void> {}

  async discoverModels(): Promise<void> {}

  async submitEnter(): Promise<void> {
    throw new Error("API provider backend does not have a website composer.");
  }

  async captureAnchor(): Promise<ProviderConversationAnchor> {
    return {
      sequence: 0,
      textSignature: "",
      elementSignature: "api",
    };
  }

  async recover(): Promise<ProviderState> {
    return this.detectState();
  }

  async syncLatestResponse(): Promise<boolean> {
    return false;
  }

  async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
    return {
      conversations: [],
      scanRounds: 0,
      partial: true,
      fallbackReason: "api-backend",
    };
  }

  async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
    throw new Error("API provider backend does not expose website history.");
  }

  async getDebugSnapshot(): Promise<ProviderDebugSnapshot> {
    const readiness = this.readiness();
    return {
      provider: this.id,
      url: this.options.config()?.baseUrl ?? "unconfigured",
      composer: "api",
      submit: "api",
      anchor: "api",
      assistant: "api",
      activeMessageId: undefined,
      assistantBinding: "api",
      latestTextLength: 0,
      isGenerating: false,
      networkActiveCount: 0,
      networkIdle: true,
      lastNetworkUrl: undefined,
      lastMutationAt: 0,
      completionDecision: readiness.ready ? "api-ready" : readiness.reason,
      completionSignals: inactiveCompletionSignals(),
      fallbackUsed: false,
    };
  }

  async setCleanMode(): Promise<void> {}

  async clearSiteData(): Promise<ProviderState> {
    return this.detectState();
  }

  async checkCompletion(): Promise<void> {}

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  layout(): void {}

  isVisible(): boolean {
    return this.visible;
  }

  ownsWebContents(_webContents: WebContents): boolean {
    return false;
  }

  destroy(): void {}

  private async complete(text: string, modelOverride?: string): Promise<string> {
    const readiness = this.readiness();
    if (!readiness.ready) throw new Error(readiness.reason);
    const config = this.options.config();
    const apiKey = this.options.apiKey();
    const baseUrl = config?.baseUrl?.replace(/\/+$/, "");
    const model = modelOverride ?? config?.model;
    if (!baseUrl || !apiKey || !model) {
      throw new Error("API provider backend is not ready.");
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: text }],
        stream: false,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`API provider request failed: ${response.status} ${detail}`.trim());
    }
    const parsed = chatCompletionResponseSchema.parse(await response.json());
    const content = parsed.choices[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    }
    throw new Error("API provider response did not include assistant content.");
  }

  private readiness(): { ready: true } | { ready: false; reason: string } {
    const config = this.options.config();
    if (!config?.enabled) {
      return {
        ready: false,
        reason: "API provider backend is reserved but not configured yet.",
      };
    }
    if (!config.baseUrl || !config.model) {
      return {
        ready: false,
        reason: "API provider backend requires a base URL and model.",
      };
    }
    if (!this.options.apiKey()) {
      return {
        ready: false,
        reason: `API provider backend requires ${apiKeyEnvName(this.id)} or AIHUB_API_KEY.`,
      };
    }
    return { ready: true };
  }
}

export class ManualProviderClient implements ProviderClient {
  readonly id: ProviderId;

  constructor(
    provider: ProviderId,
    private readonly webClient: ProviderClient,
  ) {
    this.id = provider;
  }

  async initialize(): Promise<void> {
    await this.webClient.initialize();
  }

  async attach(): Promise<void> {
    await this.webClient.attach();
    this.webClient.setVisible(true);
  }

  async detectState(): Promise<ProviderState> {
    const state = await this.webClient.detectState();
    return {
      authenticated: state.authenticated,
      ready: false,
      degraded: false,
      reason: state.authenticated
        ? manualRecoveryReason()
        : state.reason ?? manualRecoveryReason(),
    };
  }

  async createConversation(): Promise<void> {
    await this.webClient.createConversation();
  }

  async navigateToConversation(url: string): Promise<void> {
    await this.webClient.navigateToConversation(url);
  }

  async sendAndWait(input: string): Promise<string> {
    await this.composePrompt(input);
    throw new Error(manualRecoveryReason());
  }

  async send(input: string | OutgoingMessage): Promise<void> {
    await this.composePrompt(input);
  }

  async composePrompt(input: string | OutgoingMessage): Promise<void> {
    await this.attach();
    await this.webClient.composePrompt(input);
  }

  async cancel(): Promise<void> {
    await this.webClient.cancel();
  }

  async discoverModels(): Promise<void> {
    await this.webClient.discoverModels();
  }

  async submitEnter(): Promise<void> {
    await this.attach();
    await this.webClient.submitEnter();
  }

  async captureAnchor(): Promise<ProviderConversationAnchor> {
    return this.webClient.captureAnchor();
  }

  async recover(): Promise<ProviderState> {
    return this.webClient.recover();
  }

  async syncLatestResponse(): Promise<boolean> {
    return this.webClient.syncLatestResponse();
  }

  async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
    return this.webClient.listWebConversations();
  }

  async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
    return this.webClient.extractCurrentConversation();
  }

  async getDebugSnapshot(): Promise<ProviderDebugSnapshot> {
    return this.webClient.getDebugSnapshot();
  }

  async setCleanMode(enabled: boolean): Promise<void> {
    await this.webClient.setCleanMode(enabled);
  }

  async clearSiteData(): Promise<ProviderState> {
    return this.webClient.clearSiteData();
  }

  async checkCompletion(): Promise<void> {
    await this.webClient.checkCompletion();
  }

  setVisible(visible: boolean): void {
    this.webClient.setVisible(visible);
  }

  layout(drawerWidth?: number): void {
    this.webClient.layout(drawerWidth);
  }

  isVisible(): boolean {
    return this.webClient.isVisible();
  }

  ownsWebContents(webContents: WebContents): boolean {
    return this.webClient.ownsWebContents(webContents);
  }

  destroy(): void {}
}

export function apiKeyEnvName(provider: ProviderId): string {
  return `AIHUB_${provider.toUpperCase()}_API_KEY`;
}

export function manualRecoveryReason(): string {
  return "Manual provider backend is selected; open the provider page and send manually.";
}

function inactiveCompletionSignals() {
  return {
    textLength: 0,
    hasStopButton: false,
    hasStreamingIndicator: false,
    networkIdle: true,
    hasRecoverableBlocker: false,
    recoverableBlockerReason: undefined,
    stableMs: 0,
    elapsedMs: 0,
  };
}
