import path from "node:path";
import {
  type BrowserWindow,
  session,
  shell,
  WebContentsView,
} from "electron";
import { providerDefinitions } from "@aihub/adapters";
import {
  providerEventSchema,
  type ProviderEvent,
  type ProviderId,
  type ProviderState,
} from "@aihub/core";

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

export class ProviderRuntime {
  readonly id: ProviderId;
  readonly view: WebContentsView;
  private readonly definition;
  private readonly mainWindow: BrowserWindow;
  private readonly onEvent;
  private attached = false;
  private degraded = false;
  private generating = false;
  private initialized = false;
  private initializing?: Promise<void>;
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

  async send(text: string): Promise<void> {
    await this.initialize();
    this.ensureHealthy();
    if (this.generating) {
      throw new Error(`${this.id} is already generating a response.`);
    }
    await this.command("send-message", { text });
  }

  async cancel(): Promise<void> {
    if (!this.initialized) return;
    await this.command("cancel-generation");
  }

  setVisible(visible: boolean): void {
    if (visible && !this.attached) {
      this.mainWindow.contentView.addChildView(this.view);
      this.attached = true;
      this.layout();
      this.view.webContents.focus();
    } else if (!visible && this.attached) {
      this.mainWindow.contentView.removeChildView(this.view);
      this.attached = false;
    }
  }

  layout(): void {
    if (!this.attached) return;
    const [width = 960, height = 640] = this.mainWindow.getContentSize();
    this.view.setBounds({ x: 0, y: 56, width, height: Math.max(100, height - 56) });
  }

  isVisible(): boolean {
    return this.attached;
  }

  destroy(): void {
    if (this.pendingCompletion) {
      clearTimeout(this.pendingCompletion.timeout);
      this.pendingCompletion.reject(new Error("Application is closing."));
    }
    for (const command of this.pendingCommands.values()) {
      clearTimeout(command.timeout);
      command.reject(new Error("Application is closing."));
    }
    this.pendingCommands.clear();
    this.view.webContents.close();
  }

  private async command<T = void>(
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`${this.id} command "${type}" timed out.`));
      }, 15_000);
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

  private handleEvent(event: ProviderEvent): void {
    if (event.type === "adapter.degraded") {
      this.tripCircuit(event.reason);
      return;
    }
    if (event.type === "message.started") {
      this.generating = true;
    }
    if (event.type === "message.completed" && this.pendingCompletion) {
      const text = event.message.content
        .filter((block) => block.type === "text" || block.type === "code")
        .map((block) => ("text" in block ? block.text : ""))
        .join("\n");
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
