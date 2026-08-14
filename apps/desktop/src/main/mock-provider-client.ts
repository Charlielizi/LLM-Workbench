import { randomUUID } from "node:crypto";
import {
  type BrowserWindow,
  type WebContents,
  WebContentsView,
} from "electron";
import {
  PROVIDER_LABELS,
  type NormalizedMessage,
  type OutgoingMessage,
  type ProviderConversationAnchor,
  type ProviderDebugSnapshot,
  type ProviderEvent,
  type ProviderId,
  type ProviderState,
  type ProviderSurfaceLayout,
  type WebsiteConversationListSnapshot,
  type WebsiteConversationSnapshot,
} from "@aihub/core";
import type { ProviderClient } from "./provider-client";

const TOPBAR_HEIGHT = 84;
const HIDDEN_VIEWPORT_WIDTH = 1024;
const HIDDEN_VIEWPORT_HEIGHT = 720;
let trustedInteractionQueue = Promise.resolve();

interface MockTurn {
  prompt: string;
  response: string;
  messageId: string;
}

interface MockHistoryConversation {
  externalId: string;
  title: string;
  url: string;
  prompt: string;
  response: string;
}

export class MockProviderClient implements ProviderClient {
  readonly id: ProviderId;
  private readonly view: WebContentsView;
  private readonly mainWindow: BrowserWindow;
  private readonly onEvent: (provider: ProviderId, event: ProviderEvent) => void;
  private initialized = false;
  private initializing?: Promise<void>;
  private attached = false;
  private visible = false;
  private surfaceLayout: ProviderSurfaceLayout = {
    surfaceVisible: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  private cleanMode = false;
  private sequence = 0;
  private activeMessageId?: string;
  private cancelled = false;
  private composedPrompt = "";
  private turns: MockTurn[] = [];
  private readonly historyFixture: MockHistoryConversation[];
  private historyFixtureIndex = 11;

  constructor(options: {
    mainWindow: BrowserWindow;
    provider: ProviderId;
    onEvent: (provider: ProviderId, event: ProviderEvent) => void;
  }) {
    this.id = options.provider;
    this.mainWindow = options.mainWindow;
    this.onEvent = options.onEvent;
    this.historyFixture = createMockHistoryFixture(this.id);
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    const html = mockProviderHtml(this.id, PROVIDER_LABELS[this.id]);
    this.initializing = this.view.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => {
        this.initialized = true;
        this.emit({ type: "auth.changed", authenticated: true });
        this.emit({
          type: "capabilities.changed",
          capabilities: {
            attachments: [],
            modes: [],
            model: "mock-stable",
            models: [{ id: "mock-stable", label: "Mock Stable" }],
            multipleAttachments: false,
            acceptedTypes: [],
          },
        });
      })
      .finally(() => {
        this.initializing = undefined;
      });
    return this.initializing;
  }

  async attach(): Promise<void> {
    await this.initialize();
    this.ensureAttached();
    this.layout();
  }

  async detectState(): Promise<ProviderState> {
    await this.initialize();
    return { authenticated: true, ready: true, degraded: false };
  }

  async createConversation(): Promise<void> {
    await this.initialize();
    this.turns = [];
    this.sequence += 1;
    this.emit({
      type: "conversation.changed",
      externalId: `mock://${this.id}/conversation/${this.sequence}`,
    });
    await this.updatePage("", "", "ready");
  }

  async navigateToConversation(url: string): Promise<void> {
    await this.initialize();
    const fixtureIndex = this.historyFixture.findIndex(
      (conversation) => conversation.url === url,
    );
    if (fixtureIndex >= 0) {
      this.historyFixtureIndex = fixtureIndex;
    }
  }

  async sendAndWait(text: string): Promise<string> {
    await this.send(text);
    return this.turns.at(-1)?.response ?? "";
  }

  async send(input: string | OutgoingMessage): Promise<void> {
    await this.attach();
    const request = typeof input === "string"
      ? { conversationId: "mock", text: input }
      : input;
    const prompt = request.text;
    this.cancelled = false;
    this.emitStatus("checking-auth", "Mock provider session is authenticated.");
    if (prompt.includes("[mock:auth]")) {
      await this.updatePage(prompt, "", "authentication required");
      throw new Error("Login or provider verification is required before sending.");
    }

    this.emitStatus("capturing-anchor", "Captured deterministic mock anchor.");
    await this.dispatchTrustedFixtureSubmission(prompt);
    this.emitStatus("typing-message", "Filled the mock provider composer with trusted input.");
    this.emitStatus("submitting", "Submitted to the mock provider.");
    this.emitStatus("confirming-submit", "Mock provider accepted the prompt.");
    const messageId = randomUUID();
    this.activeMessageId = messageId;
    this.emit({ type: "message.started", messageId });
    this.emit({
      type: "message.assistant-bound",
      messageId,
      detail: `bound-after-anchor:${this.turns.length}->${this.turns.length + 1}`,
    });
    this.emitStatus("waiting-first-token", "Waiting for mock first token.", messageId);
    await this.updatePage(prompt, "", "thinking");

    const firstTokenDelay = prompt.includes("[mock:slow]") ? 2_500 : 120;
    await delay(firstTokenDelay);
    if (this.cancelled) return;

    const response = mockResponse(this.id, prompt);
    let streamed = "";
    this.emit({ type: "provider.network-started", url: "mock://stream" });
    for (const chunk of response.match(/[\s\S]{1,16}/g) ?? [response]) {
      if (this.cancelled) return;
      streamed += chunk;
      this.emit({ type: "message.delta", messageId, text: chunk });
      this.emitStatus("streaming", "Receiving deterministic mock response.", messageId);
      await this.updatePage(prompt, streamed, "streaming");
      await delay(45);
      if (prompt.includes("[mock:fail]") && streamed.length >= 16) {
        this.emit({ type: "provider.network-idle", url: "mock://stream" });
        this.emit({
          type: "generation.failed",
          messageId,
          code: "mock_provider_failure",
          recoverable: true,
          phase: "failed",
          detail: "Mock provider failure requested by the test prompt.",
        });
        this.activeMessageId = undefined;
        await this.updatePage(prompt, streamed, "failed");
        return;
      }
    }

    this.emit({ type: "provider.network-idle", url: "mock://stream" });
    this.emitStatus("detecting-completion", "Mock output is stable.", messageId);
    const message: NormalizedMessage = {
      id: messageId,
      conversationId: request.conversationId,
      role: "assistant",
      content: [{ type: "text", text: response }],
      providerHtml: `<p>${escapeHtml(response)}</p>`,
      status: "completed",
      statusPhase: "completed",
      provider: this.id,
      createdAt: new Date().toISOString(),
    };
    this.turns.push({ prompt, response, messageId });
    this.emit({ type: "message.completed", message });
    this.activeMessageId = undefined;
    await this.updatePage(prompt, response, "completed");
  }

  async composePrompt(input: string | OutgoingMessage): Promise<void> {
    await this.attach();
    this.composedPrompt = typeof input === "string" ? input : input.text;
    await this.updatePage(this.composedPrompt, "", "ready to submit");
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (!this.activeMessageId) return;
    const messageId = this.activeMessageId;
    this.activeMessageId = undefined;
    this.emit({ type: "provider.network-idle", url: "mock://stream" });
    this.emit({
      type: "generation.failed",
      messageId,
      code: "generation_cancelled",
      recoverable: true,
      phase: "failed",
      detail: "Mock generation was cancelled.",
    });
    await this.updatePage(this.composedPrompt, "", "cancelled");
  }

  async discoverModels(): Promise<void> {
    await this.initialize();
    this.emit({
      type: "capabilities.changed",
      capabilities: {
        attachments: [],
        modes: [],
        model: "mock-stable",
        models: [
          { id: "mock-stable", label: "Mock Stable" },
          { id: "mock-fast", label: "Mock Fast" },
        ],
        multipleAttachments: false,
        acceptedTypes: [],
      },
    });
  }

  async submitEnter(): Promise<void> {
    if (!this.composedPrompt) {
      throw new Error("Mock provider composer is empty.");
    }
    const prompt = this.composedPrompt;
    this.composedPrompt = "";
    await this.send(prompt);
  }

  async captureAnchor(): Promise<ProviderConversationAnchor> {
    const anchor = {
      sequence: this.turns.length,
      textSignature: this.turns.at(-1)?.response.slice(0, 80) ?? "",
      elementSignature: `mock-assistant-${this.turns.length}`,
      messageKey: this.turns.at(-1)?.messageId,
    };
    this.emit({
      type: "message.anchor-captured",
      messageId: anchor.messageKey,
      detail: `${anchor.elementSignature} #${anchor.sequence}`,
    });
    return anchor;
  }

  async recover(): Promise<ProviderState> {
    await this.initialize();
    this.emit({ type: "auth.changed", authenticated: true });
    return { authenticated: true, ready: true, degraded: false };
  }

  async syncLatestResponse(): Promise<boolean> {
    return Boolean(this.turns.at(-1));
  }

  async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
    if (this.historyFixture.length > 0) {
      await delay(500);
      return {
        conversations: this.historyFixture.map((conversation, index) => ({
          externalId: conversation.externalId,
          title: conversation.title,
          url: conversation.url,
          isActive: index === 11,
        })),
        scanRounds: 2,
        partial: false,
      };
    }
    return {
      conversations: this.turns.length
        ? [{
          externalId: `mock-${this.id}-1`,
          title: `Mock ${PROVIDER_LABELS[this.id]} history`,
          url: `mock://${this.id}/conversation/1`,
          isActive: true,
        }]
        : [],
      scanRounds: 1,
      partial: false,
    };
  }

  async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
    const fixtureConversation = this.historyFixture[this.historyFixtureIndex];
    if (fixtureConversation) {
      return {
        externalId: fixtureConversation.externalId,
        title: fixtureConversation.title,
        url: fixtureConversation.url,
        messages: [
          {
            key: `${fixtureConversation.externalId}-user`,
            role: "user",
            order: 0,
            content: [{ type: "text", text: fixtureConversation.prompt }],
          },
          {
            key: `${fixtureConversation.externalId}-assistant`,
            role: "assistant",
            order: 1,
            content: [{ type: "text", text: fixtureConversation.response }],
            providerHtml: `<p>${escapeHtml(fixtureConversation.response)}</p>`,
          },
        ],
        scanRounds: 1,
        partial: false,
        limitReached: false,
      };
    }
    const messages = this.turns.flatMap((turn, index) => [
      {
        key: `${turn.messageId}-user`,
        role: "user" as const,
        order: index * 2,
        content: [{ type: "text" as const, text: turn.prompt }],
      },
      {
        key: turn.messageId,
        role: "assistant" as const,
        order: index * 2 + 1,
        content: [{ type: "text" as const, text: turn.response }],
        providerHtml: `<p>${escapeHtml(turn.response)}</p>`,
      },
    ]);
    return {
      externalId: `mock-${this.id}-1`,
      title: `Mock ${PROVIDER_LABELS[this.id]} history`,
      url: `mock://${this.id}/conversation/1`,
      messages,
      scanRounds: 1,
      partial: false,
      limitReached: false,
    };
  }

  async getDebugSnapshot(): Promise<ProviderDebugSnapshot> {
    const response = this.turns.at(-1)?.response ?? "";
    const fixtureUrl = this.historyFixture[this.historyFixtureIndex]?.url;
    return {
      provider: this.id,
      url: fixtureUrl ?? `mock://${this.id}`,
      composer: "mock-composer",
      submit: "mock-submit",
      submitCandidates: ["mock-submit"],
      anchor: `mock-anchor-${this.turns.length}`,
      assistant: `mock-assistant-${this.turns.length}`,
      activeMessageId: this.activeMessageId,
      assistantBinding: this.activeMessageId
        ? `bound-after-anchor:${this.turns.length}->${this.turns.length + 1}`
        : "idle",
      latestTextLength: response.length,
      isGenerating: Boolean(this.activeMessageId),
      networkActiveCount: this.activeMessageId ? 1 : 0,
      networkIdle: !this.activeMessageId,
      lastNetworkUrl: "mock://stream",
      lastMutationAt: Date.now(),
      completionDecision: this.activeMessageId ? "wait:mock-streaming" : "complete:mock-stable",
      completionSignals: {
        textLength: response.length,
        hasStopButton: Boolean(this.activeMessageId),
        hasStreamingIndicator: Boolean(this.activeMessageId),
        networkIdle: !this.activeMessageId,
        hasRecoverableBlocker: false,
        stableMs: this.activeMessageId ? 0 : 1_000,
        elapsedMs: 1_000,
      },
      fallbackUsed: false,
    };
  }

  async setCleanMode(enabled: boolean): Promise<void> {
    this.cleanMode = enabled;
    await this.updatePage(
      this.turns.at(-1)?.prompt ?? this.composedPrompt,
      this.turns.at(-1)?.response ?? "",
      enabled ? "clean mode" : "ready",
    );
  }

  async clearSiteData(): Promise<ProviderState> {
    this.visible = false;
    return {
      authenticated: false,
      ready: false,
      degraded: false,
      reason: "Provider website data was cleared.",
    };
  }

  async checkCompletion(): Promise<void> {}

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.ensureAttached();
    this.layout();
    if (visible && this.surfaceLayout.surfaceVisible) {
      this.view.webContents.focus();
    }
  }

  layout(surfaceLayout?: ProviderSurfaceLayout): void {
    if (surfaceLayout !== undefined) this.surfaceLayout = surfaceLayout;
    if (!this.attached || this.mainWindow.isDestroyed()) return;
    const [width = 960, height = 640] = this.mainWindow.getContentSize();
    const showSurface = this.visible && this.surfaceLayout.surfaceVisible;
    const resolvedWidth = showSurface
      ? Math.max(1, Math.round(width * this.surfaceLayout.width))
      : HIDDEN_VIEWPORT_WIDTH;
    const resolvedHeight = showSurface
      ? Math.max(1, Math.round(height * this.surfaceLayout.height))
      : HIDDEN_VIEWPORT_HEIGHT;
    this.view.setBounds({
      x: showSurface ? Math.round(width * this.surfaceLayout.x) : width,
      y: showSurface ? Math.round(height * this.surfaceLayout.y) : 0,
      width: resolvedWidth,
      height: resolvedHeight,
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  ownsWebContents(webContents: WebContents): boolean {
    return this.view.webContents === webContents;
  }

  destroy(): void {
    this.cancelled = true;
    const providerDebugger = this.view.webContents.debugger;
    if (providerDebugger.isAttached()) {
      try {
        providerDebugger.detach();
      } catch {
        // The renderer may already be closing.
      }
    }
    if (this.attached && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.removeChildView(this.view);
      this.attached = false;
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private ensureAttached(): void {
    if (this.attached || this.mainWindow.isDestroyed()) return;
    this.mainWindow.contentView.addChildView(this.view);
    this.attached = true;
  }

  private emit(event: ProviderEvent): void {
    this.onEvent(this.id, event);
  }

  private emitStatus(
    phase: Extract<ProviderEvent, { type: "message.status" }>["phase"],
    detail: string,
    messageId?: string,
  ): void {
    this.emit({ type: "message.status", phase, detail, messageId });
  }

  private async updatePage(
    prompt: string,
    response: string,
    status: string,
  ): Promise<void> {
    await this.initialize();
    const state = JSON.stringify({
      prompt,
      response,
      status,
      cleanMode: this.cleanMode,
    });
    await this.view.webContents.executeJavaScript(
      `globalThis.__setMockProviderState(${state})`,
      true,
    );
  }

  private async dispatchTrustedFixtureSubmission(prompt: string): Promise<void> {
    const previousInteraction = trustedInteractionQueue;
    let releaseInteraction: () => void = () => {};
    trustedInteractionQueue = new Promise<void>((resolve) => {
      releaseInteraction = resolve;
    });
    await previousInteraction;
    try {
      await this.dispatchTrustedFixtureSubmissionNow(prompt);
    } finally {
      releaseInteraction();
    }
  }

  private async dispatchTrustedFixtureSubmissionNow(prompt: string): Promise<void> {
    const restoreHiddenLayout = !this.visible;
    if (restoreHiddenLayout && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.removeChildView(this.view);
      this.mainWindow.contentView.addChildView(this.view);
      this.view.setVisible(true);
      const [width = 960, height = 640] = this.mainWindow.getContentSize();
      this.view.setBounds({
        x: 0,
        y: TOPBAR_HEIGHT,
        width: Math.min(width, HIDDEN_VIEWPORT_WIDTH),
        height: Math.max(100, Math.min(
          height - TOPBAR_HEIGHT,
          HIDDEN_VIEWPORT_HEIGHT,
        )),
      });
      await this.view.webContents.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        true,
      );
    }
    try {
      const target = await this.view.webContents.executeJavaScript(
        `(() => {
          const composer = document.querySelector('#fixture-composer');
          const submit = document.querySelector('#fixture-submit');
          if (!composer || !submit) return null;
          globalThis.__mockTrustedAccepted = false;
          globalThis.__mockTrustedDiagnostics = {
            inputTrusted: false,
            submitTrusted: false,
            value: '',
            activeElement: '',
          };
          const composerRect = composer.getBoundingClientRect();
          const submitRect = submit.getBoundingClientRect();
          return {
            composer: {
              x: composerRect.left + composerRect.width / 2,
              y: composerRect.top + composerRect.height / 2,
            },
            submit: {
              x: submitRect.left + submitRect.width / 2,
              y: submitRect.top + submitRect.height / 2,
            },
          };
        })()`,
        true,
      ) as
        | {
            composer: { x: number; y: number };
            submit: { x: number; y: number };
          }
        | null;
      if (!target) {
        throw new Error("Mock trusted interaction fixture was not found.");
      }
      const debug = this.view.webContents.debugger;
      if (!debug.isAttached()) debug.attach("1.3");
      const key = async (
        type: "rawKeyDown" | "char" | "keyUp",
        options: {
          key: string;
          code: string;
          windowsVirtualKeyCode: number;
          modifiers?: number;
          text?: string;
        },
      ) => {
        await debug.sendCommand("Input.dispatchKeyEvent", {
          type,
          key: options.key,
          code: options.code,
          windowsVirtualKeyCode: options.windowsVirtualKeyCode,
          nativeVirtualKeyCode: options.windowsVirtualKeyCode,
          modifiers: options.modifiers ?? 0,
          unmodifiedText: options.text,
          text: options.text,
        });
      };
      const click = async (x: number, y: number) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await debug.sendCommand("Input.dispatchMouseEvent", {
            type,
            x,
            y,
            button: "left",
            buttons: type === "mousePressed" ? 1 : 0,
            clickCount: 1,
          });
        }
      };
      let result: {
        accepted: boolean;
        diagnostics?: {
          inputTrusted?: boolean;
          submitTrusted?: boolean;
          value?: string;
          activeElement?: string;
        };
      } = { accepted: false };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (this.attached && !this.mainWindow.isDestroyed()) {
          const interactionBounds = this.view.getBounds();
          this.mainWindow.contentView.removeChildView(this.view);
          this.mainWindow.contentView.addChildView(this.view);
          this.view.setVisible(true);
          this.view.setBounds(interactionBounds);
        }
        await this.view.webContents.executeJavaScript(
          `(() => {
            globalThis.__mockTrustedAccepted = false;
            globalThis.__mockTrustedDiagnostics = {
              inputTrusted: false,
              submitTrusted: false,
              value: '',
              activeElement: '',
            };
            return new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          })()`,
          true,
        );
        if (!this.mainWindow.isDestroyed()) this.mainWindow.focus();
        this.view.webContents.focus();
        await click(target.composer.x, target.composer.y);
        await this.view.webContents.executeJavaScript(
          "document.querySelector('#fixture-composer')?.focus()",
          true,
        );
        await key("rawKeyDown", {
          key: "Control",
          code: "ControlLeft",
          windowsVirtualKeyCode: 17,
          modifiers: 2,
        });
        await key("rawKeyDown", {
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          modifiers: 2,
        });
        await key("keyUp", {
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          modifiers: 2,
        });
        await key("keyUp", {
          key: "Control",
          code: "ControlLeft",
          windowsVirtualKeyCode: 17,
        });
        await key("rawKeyDown", {
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
        await key("keyUp", {
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
        await debug.sendCommand("Input.insertText", { text: prompt });
        await this.view.webContents.executeJavaScript(
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          true,
        );
        await click(target.submit.x, target.submit.y);
        result = await this.view.webContents.executeJavaScript(
          `({
            accepted: globalThis.__mockTrustedAccepted === true,
            diagnostics: globalThis.__mockTrustedDiagnostics,
          })`,
          true,
        ) as typeof result;
        if (
          !result.accepted &&
          result.diagnostics?.inputTrusted === true &&
          result.diagnostics.submitTrusted !== true
        ) {
          await this.view.webContents.executeJavaScript(
            "document.querySelector('#fixture-submit')?.focus()",
            true,
          );
          await key("rawKeyDown", {
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          });
          await key("char", {
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            text: "\r",
          });
          await key("keyUp", {
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          });
          result = await this.view.webContents.executeJavaScript(
            `({
              accepted: globalThis.__mockTrustedAccepted === true,
              diagnostics: globalThis.__mockTrustedDiagnostics,
            })`,
            true,
          ) as typeof result;
        }
        if (result.accepted) return;
      }
      throw new Error(
        `Mock provider rejected trusted interaction: ${JSON.stringify(
          result.diagnostics ?? {},
        )}`,
      );
    } finally {
      if (restoreHiddenLayout) this.layout();
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.focus();
      }
    }
  }
}

function createMockHistoryFixture(
  provider: ProviderId,
): MockHistoryConversation[] {
  if (
    process.env.AIHUB_TEST_MODE !== "1" ||
    process.env.AIHUB_TEST_HISTORY_FIXTURE !== provider
  ) {
    return [];
  }
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const externalId = `aihub-e2e-history-${String(number).padStart(2, "0")}`;
    return {
      externalId,
      title: `Remote history ${String(number).padStart(2, "0")}`,
      url: mockHistoryUrl(provider, externalId),
      prompt: `Seeded website question ${number}`,
      response: `Seeded ${PROVIDER_LABELS[provider]} answer ${number}`,
    };
  });
}

function mockHistoryUrl(provider: ProviderId, externalId: string): string {
  const urls: Record<ProviderId, string> = {
    chatgpt: `https://chatgpt.com/c/${externalId}`,
    claude: `https://claude.ai/chat/${externalId}`,
    doubao: `https://www.doubao.com/chat/${externalId.replaceAll("-", "_")}`,
    kimi: `https://www.kimi.com/chat/${externalId.replaceAll("-", "_")}`,
    deepseek: `https://chat.deepseek.com/a/chat/s/${externalId}`,
    hunyuan: `https://yuanbao.tencent.com/chat/${externalId.replaceAll("-", "_")}`,
    qianwen: `https://www.qianwen.com/chat/${externalId.replaceAll("-", "_")}`,
  };
  return urls[provider];
}

function mockResponse(provider: ProviderId, prompt: string): string {
  const cleanPrompt = prompt
    .replace(/\[mock:(?:slow|fail|auth)\]/g, "")
    .trim();
  return `Mock ${PROVIDER_LABELS[provider]} reply: ${cleanPrompt}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mockProviderHtml(provider: ProviderId, label: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <style>
      :root { color-scheme: dark; font-family: Inter, Segoe UI, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #11141b; color: #edf0f7; }
      header { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #2b303b; background: #151922; }
      .badge { border: 1px solid #385847; border-radius: 999px; padding: 5px 10px; color: #8ee3b2; font-size: 12px; }
      main { display: grid; gap: 18px; padding: 24px 20px; }
      .card { border: 1px solid #2b303b; border-radius: 20px; padding: 16px; background: #191e28; box-shadow: 0 12px 30px #0004; }
      .label { margin-bottom: 8px; color: #929cad; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
      .content { min-height: 24px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
      .fixture { display: flex; gap: 8px; }
      .fixture textarea { flex: 1; min-height: 56px; resize: none; border: 1px solid #353c49; border-radius: 12px; padding: 10px; background: #11141b; color: inherit; }
      .fixture button { border: 0; border-radius: 12px; padding: 0 16px; background: #4d7cfe; color: white; }
      body.clean .label { display: none; }
    </style>
  </head>
  <body data-provider="${provider}">
    <header>
      <strong>Mock ${escapeHtml(label)}</strong>
      <span id="status" class="badge">ready</span>
    </header>
    <main>
      <section class="card"><div class="label">Prompt</div><div id="prompt" class="content">Waiting for AIHub</div></section>
      <section class="card"><div class="label">Assistant</div><div id="response" class="content">No response yet</div></section>
      <section class="card fixture">
        <textarea id="fixture-composer" aria-label="Trusted mock composer"></textarea>
        <button id="fixture-submit" type="button">Send</button>
      </section>
    </main>
    <script>
      globalThis.__setMockProviderState = (state) => {
        document.querySelector('#status').textContent = state.status;
        document.querySelector('#prompt').textContent = state.prompt || 'Waiting for AIHub';
        document.querySelector('#response').textContent = state.response || 'No response yet';
        document.body.classList.toggle('clean', Boolean(state.cleanMode));
      };
      globalThis.__mockTrustedAccepted = false;
      globalThis.__mockTrustedDiagnostics = {
        inputTrusted: false,
        submitTrusted: false,
        value: '',
        activeElement: '',
      };
      let trustedInput = false;
      document.querySelector('#fixture-composer').addEventListener('input', (event) => {
        trustedInput = event.isTrusted;
        globalThis.__mockTrustedDiagnostics.inputTrusted = event.isTrusted;
        globalThis.__mockTrustedDiagnostics.value = event.currentTarget.value;
        globalThis.__mockTrustedDiagnostics.activeElement =
          document.activeElement?.id || document.activeElement?.tagName || '';
        if (!event.isTrusted) document.querySelector('#status').textContent = 'untrusted input rejected';
      });
      document.querySelector('#fixture-submit').addEventListener('click', (event) => {
        globalThis.__mockTrustedDiagnostics.submitTrusted = event.isTrusted;
        globalThis.__mockTrustedDiagnostics.value =
          document.querySelector('#fixture-composer').value;
        globalThis.__mockTrustedDiagnostics.activeElement =
          document.activeElement?.id || document.activeElement?.tagName || '';
        globalThis.__mockTrustedAccepted = Boolean(event.isTrusted && trustedInput);
        if (!globalThis.__mockTrustedAccepted) {
          event.preventDefault();
          document.querySelector('#status').textContent = 'untrusted submit rejected';
        }
      });
    </script>
  </body>
</html>`;
}
