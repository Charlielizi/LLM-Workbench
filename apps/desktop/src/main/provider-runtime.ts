import path from "node:path";
import {
  type BrowserWindow,
  session,
  shell,
  WebContentsView,
} from "electron";
import { providerDefinitions } from "@aihub/adapters";
import {
  messageToText,
  providerEventSchema,
  type ProviderEvent,
  type ProviderId,
  type OutgoingMessage,
  PROVIDER_MODES,
  type ProviderMode,
  type ProviderState,
} from "@aihub/core";
import {
  attachmentUploadModeForKind,
  isTransientModeSelection,
  resolveFileInputSelectors,
  type AttachmentUploadMode,
  type ProviderModeCommandState,
} from "./provider-runtime-helpers";

interface RuntimeOptions {
  mainWindow: BrowserWindow;
  provider: ProviderId;
  onEvent: (provider: ProviderId, event: ProviderEvent) => void;
}

interface PendingCompletion {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const TOPBAR_HEIGHT = 84;
const DETACH_DELAY_MS = 30_000;

export class ProviderRuntime {
  readonly id: ProviderId;
  readonly view: WebContentsView;
  private readonly definition;
  private readonly mainWindow: BrowserWindow;
  private readonly onEvent;
  private attached = false;
  private visible = false;
  private degraded = false;
  private generating = false;
  private initialized = false;
  private initializing?: Promise<void>;
  private detachTimer?: ReturnType<typeof setTimeout>;
  private pendingCompletion?: PendingCompletion;
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
    const providerSession = session.fromPartition(`persist:provider-${this.id}`);
    providerSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    providerSession.setPermissionCheckHandler(() => false);

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
    if (this.attached) return;
    this.mainWindow.contentView.addChildView(this.view);
    this.attached = true;
    this.layout();
  }

  async detectState(): Promise<ProviderState> {
    await this.initialize();
    if (this.degraded) {
      return {
        authenticated: false,
        ready: false,
        degraded: true,
        reason: "Adapter circuit breaker is open.",
      };
    }
    const result = await this.command<ProviderState>("detect-state");
    return result;
  }

  async createConversation(): Promise<void> {
    await this.initialize();
    this.ensureHealthy();
    const url = this.definition.newConversationUrls[0];
    if (!url) throw new Error(`No new-conversation URL is configured for ${this.id}.`);
    await this.view.webContents.loadURL(url);
  }

  async navigateToConversation(url: string): Promise<void> {
    await this.initialize();
    this.ensureHealthy();
    await this.view.webContents.loadURL(url);
  }

  async sendAndWait(text: string, timeoutMs = 180_000): Promise<string> {
    await this.initialize();
    this.ensureHealthy();
    if (this.pendingCompletion || this.generating) {
      throw new Error(`${this.id} is already generating a response.`);
    }
    let timeoutHandle: NodeJS.Timeout | undefined;
    const completion = new Promise<string>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        this.pendingCompletion = undefined;
        reject(new Error(`${this.id} response timed out.`));
      }, timeoutMs);
      this.pendingCompletion = { resolve, reject, timeout: timeoutHandle };
    });
    try {
      await this.command("send-message", { text });
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.pendingCompletion = undefined;
      throw error;
    }
    return completion;
  }

  async send(input: string | OutgoingMessage): Promise<void> {
    await this.initialize();
    this.ensureHealthy();
    if (this.generating) {
      throw new Error(`${this.id} is already generating a response.`);
    }
    const request = typeof input === "string"
      ? { conversationId: "", text: input }
      : input;
    if (request.model) {
      await this.configureModel(request.model);
    }
    const requestedModes = new Set(request.modes ?? []);
    for (const mode of PROVIDER_MODES) {
      await this.configureMode(mode, requestedModes.has(mode));
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
    await this.command("send-message", {
      text: request.text,
      modes: request.modes ?? [],
      model: request.model,
    });
  }

  async cancel(): Promise<void> {
    if (!this.initialized) return;
    await this.command("cancel-generation");
  }

  async discoverModels(): Promise<void> {
    await this.initialize();
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
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.detachTimer) {
      clearTimeout(this.detachTimer);
      this.detachTimer = undefined;
    }
    if (visible) {
      if (!this.attached) {
        this.mainWindow.contentView.addChildView(this.view);
        this.attached = true;
      }
      this.layout();
      this.view.webContents.focus();
      return;
    }
    if (this.attached) {
      this.layout();
      this.detachTimer = setTimeout(() => {
        this.detachTimer = undefined;
        if (!this.visible && this.attached && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(this.view);
          this.attached = false;
        }
      }, DETACH_DELAY_MS);
    }
  }

  layout(drawerWidth?: number): void {
    if (!this.attached) return;
    const [width = 960, height = 640] = this.mainWindow.getContentSize();
    if (!this.visible) {
      this.view.setBounds({
        x: Math.max(0, width - 1),
        y: Math.max(0, height - 1),
        width: 1,
        height: 1,
      });
      return;
    }
    const resolvedWidth = Math.min(
      width,
      Math.max(320, drawerWidth ?? width),
    );
    this.view.setBounds({
      x: width - resolvedWidth,
      y: TOPBAR_HEIGHT,
      width: resolvedWidth,
      height: Math.max(100, height - TOPBAR_HEIGHT),
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
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
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
  }

  private async command<T = void>(
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    const timeoutMs = type === "send-message" || type === "wait-attachments"
      ? 45_000
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
    }
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
    }
    if (event.type === "generation.failed" && this.pendingCompletion) {
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.reject(new Error(event.code));
      this.pendingCompletion = undefined;
    }
    this.onEvent(this.id, event);
  }

  private tripCircuit(reason: string): void {
    this.degraded = true;
    this.generating = false;
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
