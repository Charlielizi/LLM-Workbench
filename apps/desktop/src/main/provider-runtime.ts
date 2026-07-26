import path from "node:path";
import { createHash } from "node:crypto";
import {
  type BrowserWindow,
  type Session,
  type WebContents,
  session,
  shell,
  WebContentsView,
} from "electron";
import {
  createWebsiteAdapter,
  providerDefinitions,
  type NetworkMonitorConfig,
} from "@aihub/adapters";
import {
  messageToText,
  providerEventSchema,
  providerInteractionTargetSchema,
  providerSubmitEvidenceSchema,
  providerTextVerificationSchema,
  providerTransportEventSchema,
  websiteConversationListSnapshotSchema,
  websiteConversationSnapshotSchema,
  type ProviderConversationAnchor,
  type ProviderEvent,
  type ProviderDebugSnapshot,
  type ProviderId,
  type ProviderInteractionTarget,
  type OutgoingMessage,
  type ProviderTransportEvent,
  PROVIDER_MODES,
  type ProviderMode,
  type ProviderState,
  type WebsiteConversationListSnapshot,
  type WebsiteConversationSnapshot,
} from "@aihub/core";
import {
  attachmentUploadModeForKind,
  isTransientModeSelection,
  resolveFileInputSelectors,
  type AttachmentUploadMode,
  type ProviderModeCommandState,
} from "./provider-runtime-helpers";
import type { ProviderClient } from "./provider-client";

interface RuntimeOptions {
  mainWindow: BrowserWindow;
  provider: ProviderId;
  onEvent: (provider: ProviderId, event: ProviderEvent) => void;
  onVisibilityFallback?: (provider: ProviderId) => void;
}

interface PendingCompletion {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const TOPBAR_HEIGHT = 84;
const DETACH_DELAY_MS = 30_000;
const SURFACE_SETTLE_MS = 150;
const HIDDEN_VIEWPORT_WIDTH = 1024;
const HIDDEN_VIEWPORT_HEIGHT = 720;

export class ProviderRuntime implements ProviderClient {
  readonly id: ProviderId;
  private readonly view: WebContentsView;
  private readonly definition;
  private readonly mainWindow: BrowserWindow;
  private readonly onEvent;
  private readonly onVisibilityFallback;
  private readonly providerSession: Session;
  private readonly networkConfig: NetworkMonitorConfig | null;
  private attached = false;
  private visible = false;
  private automationLeaseCount = 0;
  private generationSurfaceActive = false;
  private drawerWidth = 520;
  private degraded = false;
  private generating = false;
  private initialized = false;
  private initializing?: Promise<void>;
  private detachTimer?: ReturnType<typeof setTimeout>;
  private pendingCompletion?: PendingCompletion;
  private activePromptMarker?: string;
  private activePromptForRetry = "";
  private externalRetryCount = 0;
  private assistantContentSeen = false;
  private latestExternalFailure?: {
    code: string;
    detail: string;
    at: number;
  };
  private readonly transportRequests = new Map<
    string,
    {
      startedAt: number;
      urlPath: string;
      method: string;
      resourceType?: string;
      uploadBytes?: number;
      uploadHash?: string;
      markerObserved?: boolean;
    }
  >();
  private readonly pendingCommands = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(options: RuntimeOptions) {
    this.id = options.provider;
    this.definition = providerDefinitions[this.id];
    this.mainWindow = options.mainWindow;
    this.onEvent = options.onEvent;
    this.onVisibilityFallback = options.onVisibilityFallback;
    const providerSession = session.fromPartition(`persist:provider-${this.id}`);
    this.providerSession = providerSession;
    this.networkConfig = createWebsiteAdapter(this.id).getNetworkMonitorConfig();
    providerSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    providerSession.setPermissionCheckHandler(() => false);
    this.installTransportProbe();

    this.view = new WebContentsView({
      webPreferences: {
        partition: `persist:provider-${this.id}`,
        preload: path.join(__dirname, "provider-preload.js"),
        additionalArguments: [`--aihub-provider=${this.id}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });

    this.view.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    this.view.webContents.on("will-navigate", (event, url) => {
      if (!this.isAllowed(url)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });
    this.view.webContents.on("ipc-message", (_event, channel, payload) => {
      if (channel.startsWith("provider:response:")) {
        const requestId = channel.slice("provider:response:".length);
        const pending = this.pendingCommands.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(requestId);
        if (payload?.ok) pending.resolve(payload.value);
        else pending.reject(new Error(payload?.error ?? "Provider command failed."));
        return;
      }
      if (channel !== "provider:event") return;
      const parsed = providerEventSchema.safeParse(payload);
      if (!parsed.success) {
        this.tripCircuit("Provider bridge emitted an invalid event.");
        return;
      }
      this.handleEvent(parsed.data);
    });
    this.view.webContents.on(
      "render-process-gone",
      (_event, details) =>
        this.tripCircuit(`Provider renderer stopped: ${details.reason}`),
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.view.webContents
      .loadURL(this.definition.loginUrl)
      .then(() => {
        this.initialized = true;
      })
      .finally(() => {
        this.initializing = undefined;
      });
    return this.initializing;
  }

  async attach(): Promise<void> {
    await this.initialize();
    const newlyAttached = this.ensureAttached();
    this.layout();
    if (newlyAttached) await this.waitForSurfaceLayout();
  }

  async detectState(): Promise<ProviderState> {
    return this.withAutomationSurface(async () => {
      if (this.degraded) {
        return {
          authenticated: false,
          ready: false,
          degraded: true,
          reason: "Adapter circuit breaker is open.",
        };
      }
      return this.command<ProviderState>("detect-state");
    });
  }

  async createConversation(): Promise<void> {
    await this.withAutomationSurface(async () => {
      this.ensureHealthy();
      const url = this.definition.newConversationUrls[0];
      if (!url) throw new Error(`No new-conversation URL is configured for ${this.id}.`);
      await this.view.webContents.loadURL(url);
    });
  }

  async navigateToConversation(url: string): Promise<void> {
    await this.withAutomationSurface(async () => {
      this.ensureHealthy();
      await this.view.webContents.loadURL(url);
    });
  }

  async sendAndWait(text: string, timeoutMs = 180_000): Promise<string> {
    if (this.pendingCompletion || this.generating || this.generationSurfaceActive) {
      throw new Error(`${this.id} is already generating a response.`);
    }
    const newlyAttached = this.beginGenerationSurface();
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await this.initialize();
      if (newlyAttached) await this.waitForSurfaceLayout();
      this.ensureHealthy();
      const completion = new Promise<string>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          this.pendingCompletion = undefined;
          this.endGenerationSurface();
          reject(new Error(`${this.id} response timed out.`));
        }, timeoutMs);
        this.pendingCompletion = { resolve, reject, timeout: timeoutHandle };
      });
      this.externalRetryCount = 0;
      await this.sendTrustedMessage(text);
      return completion;
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.pendingCompletion = undefined;
      this.endGenerationSurface();
      throw error;
    }
  }

  async send(input: string | OutgoingMessage): Promise<void> {
    if (this.generating || this.generationSurfaceActive) {
      throw new Error(`${this.id} is already generating a response.`);
    }
    const newlyAttached = this.beginGenerationSurface();
    try {
      await this.initialize();
      if (newlyAttached) await this.waitForSurfaceLayout();
      this.ensureHealthy();
      const request = typeof input === "string"
        ? { conversationId: "", text: input }
        : input;
      if (request.model) {
        await this.configureModel(request.model);
      }
      if (request.modes !== undefined) {
        const requestedModes = new Set(request.modes);
        for (const mode of PROVIDER_MODES) {
          await this.configureMode(mode, requestedModes.has(mode));
        }
      }
      if (request.attachments?.length) {
        const groups = new Map<AttachmentUploadMode, typeof request.attachments>();
        for (const attachment of request.attachments) {
          const uploadMode = attachmentUploadModeForKind(attachment.kind);
          const current = groups.get(uploadMode) ?? [];
          groups.set(uploadMode, [...current, attachment]);
        }
        for (const [uploadMode, attachments] of groups) {
          let preparation = await this.command<{
            ready: boolean;
            x?: number;
            y?: number;
          }>("prepare-attachments", { attachmentMode: uploadMode });
          if (
            !preparation.ready &&
            preparation.x !== undefined &&
            preparation.y !== undefined
          ) {
            await this.dispatchTrustedClick(preparation.x, preparation.y);
            for (let attempt = 0; attempt < 30; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              preparation = await this.command<{
                ready: boolean;
                x?: number;
                y?: number;
              }>("prepare-attachments", { attachmentMode: uploadMode });
              if (preparation.ready) break;
            }
          }
          if (!preparation.ready) {
            throw new Error(`${this.id} website attachment control was not found.`);
          }
          await this.setFileInputFiles(
            attachments.map((attachment) => attachment.localPath),
          );
          await this.command("wait-attachments", {
            names: attachments.map((attachment) => attachment.name),
          });
        }
      }
      this.externalRetryCount = 0;
      await this.sendTrustedMessage(request.text);
    } catch (error) {
      this.endGenerationSurface();
      throw error;
    }
  }

  async composePrompt(input: string | OutgoingMessage): Promise<void> {
    await this.withAutomationSurface(async () => {
      const request = typeof input === "string"
        ? { conversationId: "", text: input }
        : input;
      if (request.model) {
        await this.configureModel(request.model);
      }
      if (request.modes !== undefined) {
        const requestedModes = new Set(request.modes);
        for (const mode of PROVIDER_MODES) {
          await this.configureMode(mode, requestedModes.has(mode));
        }
      }
      await this.command("compose-message", {
        text: request.text,
        modes: request.modes ?? [],
        model: request.model,
      });
    });
  }

  async cancel(): Promise<void> {
    if (!this.initialized) return;
    try {
      await this.withAutomationSurface(async () => {
        const target = providerInteractionTargetSchema.parse(
          await this.command("prepare-trusted-cancel"),
        );
        await this.dispatchTrustedSubmit(target);
        await this.command("finalize-trusted-cancel");
      });
    } finally {
      this.generating = false;
      this.endGenerationSurface();
    }
  }

  async discoverModels(): Promise<void> {
    await this.withAutomationSurface(async () => {
      this.ensureHealthy();
      const action = await this.command<{
        available: boolean;
        selected: boolean;
        x?: number;
        y?: number;
      }>("discover-models");
      if (!action.available) return;
      if (action.x !== undefined && action.y !== undefined) {
        await this.dispatchTrustedClick(action.x, action.y);
      }
    });
  }

  async submitEnter(): Promise<void> {
    const newlyAttached = this.beginGenerationSurface();
    try {
      await this.initialize();
      if (newlyAttached) await this.waitForSurfaceLayout();
      this.ensureHealthy();
      await this.dispatchEnterKey();
    } catch (error) {
      this.endGenerationSurface();
      throw error;
    }
  }

  async captureAnchor(): Promise<ProviderConversationAnchor> {
    return this.withAutomationSurface(() =>
      this.command<ProviderConversationAnchor>("capture-anchor"));
  }

  async recover(): Promise<ProviderState> {
    return this.withAutomationSurface(async () => {
      this.degraded = false;
      try {
        const state = await this.command<ProviderState>("detect-state");
        this.degraded = Boolean(state.degraded);
        return state;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.tripCircuit(detail);
        throw error;
      }
    });
  }

  async syncLatestResponse(): Promise<boolean> {
    return this.withAutomationSurface(() =>
      this.command<boolean>("sync-latest-response"));
  }

  async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
    return this.withAutomationSurface(async () =>
      websiteConversationListSnapshotSchema.parse(
        await this.command<unknown>("list-web-conversations"),
      ));
  }

  async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
    return this.withAutomationSurface(async () =>
      websiteConversationSnapshotSchema.parse(
        await this.command<unknown>("extract-current-conversation"),
      ));
  }

  async getDebugSnapshot(): Promise<ProviderDebugSnapshot> {
    return this.withAutomationSurface(() =>
      this.command<ProviderDebugSnapshot>("get-debug-snapshot"));
  }

  async setCleanMode(enabled: boolean): Promise<void> {
    await this.withAutomationSurface(() =>
      this.command("set-clean-mode", { cleanMode: enabled }));
  }

  async clearSiteData(): Promise<ProviderState> {
    this.setVisible(false);
    this.degraded = false;
    await this.providerSession.clearStorageData();
    await this.providerSession.clearCache();
    if (!this.view.webContents.isDestroyed()) {
      await this.view.webContents.loadURL(this.definition.loginUrl);
      this.initialized = true;
    }
    return {
      authenticated: false,
      ready: false,
      degraded: false,
    };
  }

  async checkCompletion(): Promise<void> {
    await this.withAutomationSurface(() => this.command("check-completion"));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.cancelScheduledDetach();
    if (visible) {
      this.ensureAttached();
      this.layout();
      this.view.webContents.focus();
      return;
    }
    if (this.attached) {
      this.layout();
      this.scheduleDetach();
    }
  }

  layout(drawerWidth?: number): void {
    if (drawerWidth !== undefined) {
      this.drawerWidth = drawerWidth;
    }
    if (!this.attached) return;
    const [width = 960, height = 640] = this.mainWindow.getContentSize();
    const resolvedWidth = this.visible
      ? Math.min(width, Math.max(320, this.drawerWidth))
      : HIDDEN_VIEWPORT_WIDTH;
    const resolvedHeight = this.visible
      ? Math.max(100, height - TOPBAR_HEIGHT)
      : HIDDEN_VIEWPORT_HEIGHT;
    const x = this.visible ? width - resolvedWidth : width;
    this.view.setBounds({
      x,
      y: TOPBAR_HEIGHT,
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
    if (this.initialized && !this.view.webContents.isDestroyed()) {
      void this.command("dispose").catch(() => undefined);
    }
    if (this.detachTimer) {
      clearTimeout(this.detachTimer);
      this.detachTimer = undefined;
    }
    if (this.pendingCompletion) {
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.reject(new Error("Application is closing."));
    }
    for (const command of this.pendingCommands.values()) {
      clearTimeout(command.timeout);
      command.reject(new Error("Application is closing."));
    }
    this.pendingCommands.clear();
    if (this.attached && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.removeChildView(this.view);
      this.attached = false;
    }
    this.attached = false;
    const providerDebugger = this.view.webContents.debugger;
    if (providerDebugger.isAttached()) {
      try {
        providerDebugger.detach();
      } catch {
        // The renderer may already be closing.
      }
    }
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
  }

  private async command<T = void>(
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    const timeoutMs =
      type === "send-message" || type === "wait-attachments"
        ? 45_000
        : type === "confirm-trusted-submit"
          ? 25_000
          : 15_000;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`${this.id} command "${type}" timed out.`));
      }, timeoutMs);
      this.pendingCommands.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.view.webContents.send("provider:command", {
        requestId,
        type,
        payload,
      });
    });
  }

  private async setFileInputFiles(paths: string[]): Promise<void> {
    if (!this.view.webContents.debugger.isAttached()) {
      this.view.webContents.debugger.attach("1.3");
    }
    const document = await this.view.webContents.debugger.sendCommand(
      "DOM.getDocument",
      { depth: 0, pierce: true },
    ) as { root: { nodeId: number } };
    let nodeId = 0;
    for (const selector of resolveFileInputSelectors(this.definition)) {
      const result = await this.view.webContents.debugger.sendCommand(
        "DOM.querySelector",
        {
          nodeId: document.root.nodeId,
          selector,
        },
      ) as { nodeId: number };
      if (result.nodeId) {
        nodeId = result.nodeId;
        break;
      }
    }
    if (!nodeId) {
      throw new Error(`${this.id} website file input was not found.`);
    }
    await this.view.webContents.debugger.sendCommand(
      "DOM.setFileInputFiles",
      { nodeId, files: paths },
    );
  }

  private async dispatchTrustedClick(x: number, y: number): Promise<void> {
    if (!this.view.webContents.debugger.isAttached()) {
      this.view.webContents.debugger.attach("1.3");
    }
    const { width, height } = this.view.getBounds();
    if (x < 0 || x > width || y < 0 || y > height) {
      throw new Error(
        `Click coordinates (${x}, ${y}) out of view bounds (${width}x${height}).`,
      );
    }
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.view.webContents.debugger.sendCommand(
        "Input.dispatchMouseEvent",
        {
          type,
          x,
          y,
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
        },
      );
    }
  }

  private ensureDebuggerAttached(): void {
    if (!this.view.webContents.debugger.isAttached()) {
      this.view.webContents.debugger.attach("1.3");
    }
  }

  private async dispatchTrustedKey(
    type: "rawKeyDown" | "keyUp",
    options: {
      key: string;
      code: string;
      windowsVirtualKeyCode: number;
      modifiers?: number;
    },
  ): Promise<void> {
    this.ensureDebuggerAttached();
    await this.view.webContents.debugger.sendCommand(
      "Input.dispatchKeyEvent",
      {
        type,
        key: options.key,
        code: options.code,
        windowsVirtualKeyCode: options.windowsVirtualKeyCode,
        nativeVirtualKeyCode: options.windowsVirtualKeyCode,
        modifiers: options.modifiers ?? 0,
      },
    );
  }

  private async dispatchTrustedText(
    target: ProviderInteractionTarget,
    text: string,
  ): Promise<void> {
    await this.dispatchTrustedClick(target.x, target.y);
    this.view.webContents.focus();
    await this.dispatchTrustedKey("rawKeyDown", {
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      modifiers: 2,
    });
    await this.dispatchTrustedKey("rawKeyDown", {
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await this.dispatchTrustedKey("keyUp", {
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await this.dispatchTrustedKey("keyUp", {
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
    });
    await this.dispatchTrustedKey("rawKeyDown", {
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await this.dispatchTrustedKey("keyUp", {
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    this.ensureDebuggerAttached();
    await this.view.webContents.debugger.sendCommand("Input.insertText", { text });
  }

  private async dispatchTrustedSubmit(
    target: ProviderInteractionTarget,
  ): Promise<void> {
    if (target.inputMethod === "enter") {
      await this.dispatchTrustedClick(target.x, target.y);
      await this.dispatchEnterKey();
      return;
    }
    await this.dispatchTrustedClick(target.x, target.y);
  }

  private async prepareTrustedSendTarget(
    text: string,
  ): Promise<ProviderInteractionTarget> {
    try {
      const value = await this.command("prepare-trusted-send", { text });
      return providerInteractionTargetSchema.parse(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        this.visible ||
        !/composer|target|visible|layout|not ready/i.test(detail)
      ) {
        throw error;
      }
      this.setVisible(true);
      this.onVisibilityFallback?.(this.id);
      await this.waitForSurfaceLayout();
      const value = await this.command("prepare-trusted-send", { text });
      return providerInteractionTargetSchema.parse(value);
    }
  }

  private async sendTrustedMessage(text: string): Promise<void> {
    this.activePromptForRetry = text;
    this.activePromptMarker =
      text.match(/\bAIHUB_[A-Z0-9][A-Z0-9_-]{5,127}\b/i)?.[0];
    this.assistantContentSeen = false;
    this.latestExternalFailure = undefined;
    let generationStarted = false;
    try {
      let composerTarget = await this.prepareTrustedSendTarget(text);
      await this.dispatchTrustedText(composerTarget, text);
      let verification = providerTextVerificationSchema.parse(
        await this.command("verify-trusted-input", { text }),
      );
      if (!verification.matched && !this.visible) {
        this.setVisible(true);
        this.onVisibilityFallback?.(this.id);
        await this.waitForSurfaceLayout();
        composerTarget = await this.prepareTrustedSendTarget(text);
        await this.dispatchTrustedText(composerTarget, text);
        verification = providerTextVerificationSchema.parse(
          await this.command("verify-trusted-input", { text }),
        );
      }
      if (!verification.matched) {
        throw new Error(
          `Trusted text verification failed: actual=${verification.actualLength}/${verification.actualHash} expected=${verification.expectedLength}/${verification.expectedHash}.`,
        );
      }
      let submitTarget: ProviderInteractionTarget;
      try {
        submitTarget = providerInteractionTargetSchema.parse(
          await this.command("arm-trusted-send", { text }),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (
          this.visible ||
          !/submit|send button|target|visible|layout/i.test(detail)
        ) {
          throw error;
        }
        this.setVisible(true);
        this.onVisibilityFallback?.(this.id);
        await this.waitForSurfaceLayout();
        submitTarget = providerInteractionTargetSchema.parse(
          await this.command("arm-trusted-send", { text }),
        );
      }
      await this.dispatchTrustedSubmit(submitTarget);
      let evidence = providerSubmitEvidenceSchema.parse(
        await this.command("confirm-trusted-submit"),
      );
      if (!evidence.confirmed && evidence.retryAllowed && this.id === "deepseek") {
        const retryComposer = providerInteractionTargetSchema.parse(
          await this.command("prepare-deepseek-trusted-retry"),
        );
        await this.dispatchTrustedText(retryComposer, text);
        const retryVerification = providerTextVerificationSchema.parse(
          await this.command("verify-trusted-input", { text }),
        );
        if (!retryVerification.matched) {
          throw new Error("DeepSeek trusted retry text verification failed.");
        }
        submitTarget = providerInteractionTargetSchema.parse(
          await this.command("trusted-submit-target"),
        );
        await this.dispatchTrustedSubmit(submitTarget);
        evidence = providerSubmitEvidenceSchema.parse(
          await this.command("confirm-trusted-submit"),
        );
      }
      if (!evidence.confirmed) {
        throw new Error(
          [
            "Trusted provider submission was not confirmed.",
            `userTurn=${evidence.userTurnSeen}`,
            `transport=${evidence.transportSeen}`,
            `assistant=${evidence.assistantStarted}`,
            `sessionCreated=${evidence.sessionCreated}`,
          ].join(" "),
        );
      }
      if (evidence.transportSeen) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const immediateExternalFailure = this.currentExternalFailure();
      if (
        immediateExternalFailure &&
        !this.assistantContentSeen &&
        this.externalRetryCount < 1
      ) {
        this.externalRetryCount += 1;
        const retryTarget = providerInteractionTargetSchema.parse(
          await this.command("prepare-trusted-external-retry", { text }),
        );
        this.latestExternalFailure = undefined;
        await this.dispatchTrustedSubmit(retryTarget);
        const retryEvidence = providerSubmitEvidenceSchema.parse(
          await this.command("confirm-trusted-submit"),
        );
        if (!retryEvidence.confirmed) {
          throw new Error(
            `${immediateExternalFailure.detail} The trusted website retry produced no matching transport or assistant turn.`,
          );
        }
        await this.command("start-trusted-generation", { flaky: true });
      } else {
        await this.command("start-trusted-generation");
      }
      generationStarted = true;
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.focus();
      }
    } catch (error) {
      if (!generationStarted) {
        await this.command("abort-trusted-send").catch(() => undefined);
        this.activePromptMarker = undefined;
      }
      throw error;
    }
  }

  private async retryExternalFailureViaWebsite(
    failure: { code: string; detail: string },
  ): Promise<void> {
    const newlyAttached = this.beginGenerationSurface();
    try {
      if (newlyAttached) await this.waitForSurfaceLayout();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const target = providerInteractionTargetSchema.parse(
        await this.command("prepare-trusted-external-retry", {
          text: this.activePromptForRetry,
        }),
      );
      this.assistantContentSeen = false;
      this.latestExternalFailure = undefined;
      await this.dispatchTrustedSubmit(target);
      const evidence = providerSubmitEvidenceSchema.parse(
        await this.command("confirm-trusted-submit"),
      );
      if (!evidence.confirmed) {
        throw new Error("The provider retry action produced no matching transport or assistant turn.");
      }
      await this.command("start-trusted-generation", { flaky: true });
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.focus();
      }
    } catch (error) {
      await this.command("abort-trusted-send").catch(() => undefined);
      this.endGenerationSurface();
      const detail = error instanceof Error ? error.message : String(error);
      const retryFailure: ProviderEvent = {
        type: "generation.failed",
        code: "provider_external_retry_unavailable",
        recoverable: false,
        phase: "failed",
        detail: `${failure.detail} Automatic trusted retry was not completed: ${detail}`,
      };
      if (this.pendingCompletion) {
        clearTimeout(this.pendingCompletion.timeout);
        this.pendingCompletion.reject(new Error(retryFailure.detail));
        this.pendingCompletion = undefined;
      }
      this.onEvent(this.id, retryFailure);
    }
  }

  private currentExternalFailure():
    | { code: string; detail: string; at: number }
    | undefined {
    return this.latestExternalFailure;
  }

  private async withAutomationSurface<T>(operation: () => Promise<T>): Promise<T> {
    const newlyAttached = this.acquireAutomationSurface();
    try {
      await this.initialize();
      if (newlyAttached) await this.waitForSurfaceLayout();
      return await operation();
    } finally {
      this.releaseAutomationSurface();
    }
  }

  private acquireAutomationSurface(): boolean {
    this.automationLeaseCount += 1;
    this.cancelScheduledDetach();
    const newlyAttached = this.ensureAttached();
    this.layout();
    return newlyAttached;
  }

  private releaseAutomationSurface(): void {
    this.automationLeaseCount = Math.max(0, this.automationLeaseCount - 1);
    if (!this.visible && !this.shouldKeepAttached()) {
      this.layout();
      this.scheduleDetach();
    }
  }

  private beginGenerationSurface(): boolean {
    this.generationSurfaceActive = true;
    this.cancelScheduledDetach();
    const newlyAttached = this.ensureAttached();
    this.layout();
    return newlyAttached;
  }

  private endGenerationSurface(): void {
    this.generationSurfaceActive = false;
    if (!this.visible && !this.shouldKeepAttached()) {
      this.layout();
      this.scheduleDetach();
    }
  }

  private shouldKeepAttached(): boolean {
    return this.visible || this.generationSurfaceActive || this.automationLeaseCount > 0;
  }

  private ensureAttached(): boolean {
    if (this.attached || this.mainWindow.isDestroyed()) return false;
    this.mainWindow.contentView.addChildView(this.view);
    this.attached = true;
    return true;
  }

  private waitForSurfaceLayout(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SURFACE_SETTLE_MS));
  }

  private cancelScheduledDetach(): void {
    if (!this.detachTimer) return;
    clearTimeout(this.detachTimer);
    this.detachTimer = undefined;
  }

  private scheduleDetach(): void {
    if (!this.attached || this.shouldKeepAttached() || this.detachTimer) return;
    this.detachTimer = setTimeout(() => {
      this.detachTimer = undefined;
      if (
        !this.shouldKeepAttached() &&
        this.attached &&
        !this.mainWindow.isDestroyed()
      ) {
        this.mainWindow.contentView.removeChildView(this.view);
        this.attached = false;
      }
    }, DETACH_DELAY_MS);
  }

  private async dispatchEnterKey(): Promise<void> {
    if (!this.view.webContents.debugger.isAttached()) {
      this.view.webContents.debugger.attach("1.3");
    }
    this.view.webContents.focus();
    for (const [type, text] of [
      ["rawKeyDown", undefined],
      ["char", "\r"],
      ["keyUp", undefined],
    ] as const) {
      await this.view.webContents.debugger.sendCommand(
        "Input.dispatchKeyEvent",
        {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
          unmodifiedText: "\r",
          text,
        },
      );
    }
  }

  private installTransportProbe(): void {
    if (!this.networkConfig || !this.providerSession.webRequest) return;
    const filter = { urls: ["*://*/*"] };
    this.providerSession.webRequest.onBeforeRequest(
      filter,
      (details, callback) => {
        if (!this.isTrackedTransportUrl(details.url)) {
          callback({});
          return;
        }
        const chunks = (details.uploadData ?? [])
          .map((entry) => entry.bytes)
          .filter((bytes): bytes is Buffer => Boolean(bytes));
        const uploadBytes = chunks.reduce((total, bytes) => total + bytes.length, 0);
        const uploadHash = uploadBytes > 0
          ? createHash("sha256")
              .update(Buffer.concat(chunks))
              .digest("hex")
          : undefined;
        const markerObserved = this.activePromptMarker
          ? chunks.some((bytes) =>
              bytes.toString("utf8").includes(this.activePromptMarker ?? ""),
            )
          : undefined;
        const requestId = String(details.id);
        const request = {
          startedAt: Date.now(),
          urlPath: this.sanitizeTransportUrl(details.url),
          method: details.method,
          resourceType: details.resourceType,
          uploadBytes: uploadBytes || undefined,
          uploadHash,
          markerObserved,
        };
        this.transportRequests.set(requestId, request);
        this.emitTransport({
          requestId,
          phase: "started",
          urlPath: request.urlPath,
          method: request.method,
          resourceType: request.resourceType,
          uploadBytes: request.uploadBytes,
          uploadHash: request.uploadHash,
          markerObserved: request.markerObserved,
        });
        callback({});
      },
    );
    this.providerSession.webRequest.onResponseStarted(filter, (details) => {
      const request = this.transportRequests.get(String(details.id));
      if (!request) return;
      if (details.statusCode === 429 || details.statusCode >= 500) {
        this.latestExternalFailure = {
          code: `http_${details.statusCode}`,
          detail: `Provider transport returned HTTP ${details.statusCode} for ${request.urlPath}.`,
          at: Date.now(),
        };
      }
      this.emitTransport({
        requestId: String(details.id),
        phase: "headers",
        urlPath: request.urlPath,
        method: request.method,
        statusCode: details.statusCode,
        durationMs: Math.max(0, Date.now() - request.startedAt),
        resourceType: request.resourceType,
        uploadBytes: request.uploadBytes,
        uploadHash: request.uploadHash,
        markerObserved: request.markerObserved,
      });
    });
    this.providerSession.webRequest.onCompleted(filter, (details) => {
      const requestId = String(details.id);
      const request = this.transportRequests.get(requestId);
      if (!request) return;
      this.transportRequests.delete(requestId);
      this.emitTransport({
        requestId,
        phase: "completed",
        urlPath: request.urlPath,
        method: request.method,
        statusCode: details.statusCode,
        durationMs: Math.max(0, Date.now() - request.startedAt),
        resourceType: request.resourceType,
        uploadBytes: request.uploadBytes,
        uploadHash: request.uploadHash,
        markerObserved: request.markerObserved,
      });
    });
    this.providerSession.webRequest.onErrorOccurred(filter, (details) => {
      const requestId = String(details.id);
      const request = this.transportRequests.get(requestId);
      if (!request) return;
      this.transportRequests.delete(requestId);
      this.latestExternalFailure = {
        code: "network_error",
        detail: `Provider transport failed for ${request.urlPath}: ${details.error}.`,
        at: Date.now(),
      };
      this.emitTransport({
        requestId,
        phase: "failed",
        urlPath: request.urlPath,
        method: request.method,
        durationMs: Math.max(0, Date.now() - request.startedAt),
        resourceType: request.resourceType,
        uploadBytes: request.uploadBytes,
        uploadHash: request.uploadHash,
        markerObserved: request.markerObserved,
        error: details.error,
      });
    });
  }

  private isTrackedTransportUrl(url: string): boolean {
    const config = this.networkConfig;
    if (!config) return false;
    const lowerUrl = url.toLowerCase();
    if (
      config.urlPatterns.length > 0 &&
      !config.urlPatterns.some((pattern) =>
        lowerUrl.includes(pattern.toLowerCase()),
      )
    ) {
      return false;
    }
    if (!config.urlPathEndsWith?.length) return true;
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return config.urlPathEndsWith.some((suffix) =>
        pathname.endsWith(suffix.toLowerCase()),
      );
    } catch {
      return false;
    }
  }

  private sanitizeTransportUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "invalid-url";
    }
  }

  private emitTransport(event: ProviderTransportEvent): void {
    const parsed = providerTransportEventSchema.parse(event);
    this.onEvent(this.id, { type: "provider.transport", event: parsed });
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.send("provider:transport", parsed);
    }
  }

  private async configureMode(
    mode: ProviderMode,
    enabled: boolean,
  ): Promise<void> {
    let state = await this.command<ProviderModeCommandState>(
      "configure-mode",
      { mode, enabled },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!state.available) {
        if (enabled) {
          throw new Error(`${this.id} mode "${mode}" is not available.`);
        }
        return;
      }
      if (state.enabled === enabled) return;
      if (state.x === undefined || state.y === undefined) break;
      await this.dispatchTrustedClick(state.x, state.y);
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (isTransientModeSelection(state, enabled)) {
        return;
      }
      state = await this.command<ProviderModeCommandState>(
        "configure-mode",
        { mode, enabled },
      );
    }
    if (!state.available || state.enabled !== enabled) {
      throw new Error(`${this.id} mode "${mode}" did not change state.`);
    }
  }

  private async configureModel(model: string): Promise<void> {
    type ModelState = {
      available: boolean;
      selected: boolean;
      x?: number;
      y?: number;
    };
    let state = await this.command<ModelState>(
      "configure-model",
      { model },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!state.available) {
        throw new Error(`${this.id} requested model is not available.`);
      }
      if (state.selected) return;
      if (state.x === undefined || state.y === undefined) break;
      await this.dispatchTrustedClick(state.x, state.y);
      await new Promise((resolve) => setTimeout(resolve, 180));
      state = await this.command<ModelState>(
        "configure-model",
        { model },
      );
    }
    throw new Error(`${this.id} requested model could not be selected.`);
  }

  private handleEvent(event: ProviderEvent): void {
    if (event.type === "adapter.degraded") {
      this.tripCircuit(event.reason);
      return;
    }
    if (event.type === "message.started") {
      this.generating = true;
      this.beginGenerationSurface();
    }
    if (
      (event.type === "message.delta" && event.text.length > 0) ||
      (event.type === "message.snapshot" && event.text.length > 0)
    ) {
      this.assistantContentSeen = true;
    }
    const externalFailure =
      event.type === "generation.failed" &&
      this.latestExternalFailure &&
      Date.now() - this.latestExternalFailure.at <= 660_000
        ? this.latestExternalFailure
        : undefined;
    const shouldRetryExternalFailure = Boolean(
      event.type === "generation.failed" &&
      externalFailure &&
      !this.assistantContentSeen &&
      this.externalRetryCount < 1 &&
      this.activePromptForRetry,
    );
    if (event.type === "message.completed" && this.pendingCompletion) {
      const text = messageToText(event.message);
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.resolve(text);
      this.pendingCompletion = undefined;
    }
    if (
      event.type === "message.completed" ||
      event.type === "generation.failed"
    ) {
      this.generating = false;
      this.endGenerationSurface();
    }
    if (
      event.type === "generation.failed" &&
      this.pendingCompletion &&
      !shouldRetryExternalFailure
    ) {
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.reject(new Error(event.code));
      this.pendingCompletion = undefined;
    }
    const forwardedEvent: ProviderEvent =
      event.type === "generation.failed" && externalFailure
        ? {
            ...event,
            code: externalFailure.code,
            detail: externalFailure.detail,
          }
        : event;
    this.onEvent(this.id, forwardedEvent);
    if (
      event.type === "generation.failed" &&
      shouldRetryExternalFailure &&
      externalFailure
    ) {
      this.externalRetryCount += 1;
      void this.retryExternalFailureViaWebsite(externalFailure);
    }
    if (event.type === "message.completed") {
      this.activePromptForRetry = "";
      this.activePromptMarker = undefined;
      this.latestExternalFailure = undefined;
    }
  }

  private tripCircuit(reason: string): void {
    this.degraded = true;
    this.generating = false;
    this.endGenerationSurface();
    if (this.pendingCompletion) {
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.reject(new Error(reason));
      this.pendingCompletion = undefined;
    }
    this.onEvent(this.id, { type: "adapter.degraded", reason });
    this.setVisible(true);
  }

  private ensureHealthy(): void {
    if (this.degraded) {
      throw new Error(
        `${this.id} adapter is degraded. Open the provider website to recover.`,
      );
    }
  }

  private isAllowed(url: string): boolean {
    try {
      return this.definition.allowedOrigins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }
}
