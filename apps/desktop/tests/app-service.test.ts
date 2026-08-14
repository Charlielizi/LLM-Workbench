import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/main/database";
import type {
  WebsiteConversationListSnapshot,
  WebsiteConversationSnapshot,
} from "@aihub/core";

const runtimeState = new Map<string, {
  sendImpl?: (input: unknown) => Promise<void>;
  composeImpl?: (input: unknown) => Promise<void>;
  submitEnterImpl?: () => Promise<void>;
  anchorImpl?: () => Promise<unknown>;
  detectImpl?: () => Promise<{ authenticated: boolean; ready: boolean; degraded: boolean; reason?: string }>;
  recoverImpl?: () => Promise<{ authenticated: boolean; ready: boolean; degraded: boolean; reason?: string }>;
  syncImpl?: () => Promise<boolean>;
  historyImpl?: () => Promise<WebsiteConversationListSnapshot>;
  snapshotImpl?: () => Promise<WebsiteConversationSnapshot>;
  navigateImpl?: (url: string) => Promise<void>;
  ownsImpl?: (webContents: unknown) => boolean;
  clearImpl?: () => Promise<{
    authenticated: boolean;
    ready: boolean;
    degraded: boolean;
    reason?: string;
  }>;
  onEvent?: (provider: string, event: unknown) => void;
  visible?: boolean;
}>();

vi.mock("electron", () => ({
  WebContentsView: class {
    readonly webContents = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      close: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      debugger: {
        attach: vi.fn(),
        detach: vi.fn(),
        isAttached: vi.fn().mockReturnValue(false),
        sendCommand: vi.fn().mockResolvedValue({}),
      },
    };
    setBounds(): void {}
  },
  app: {
    getVersion: vi.fn().mockReturnValue("0.1.0"),
    getLocale: vi.fn().mockReturnValue("en-US"),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock("../src/main/provider-runtime", () => ({
  ProviderRuntime: class {
    readonly id: string;
    constructor(options: { provider: string; onEvent: (provider: string, event: unknown) => void }) {
      this.id = options.provider;
      runtimeState.set(this.id, { onEvent: options.onEvent });
    }
    async initialize(): Promise<void> {}
    async detectState(): Promise<{ authenticated: boolean; ready: boolean; degraded: boolean }> {
      const entry = runtimeState.get(this.id);
      if (entry?.detectImpl) {
        return entry.detectImpl();
      }
      return { authenticated: true, ready: true, degraded: false };
    }
    async createConversation(): Promise<void> {}
    async navigateToConversation(url: string): Promise<void> {
      await runtimeState.get(this.id)?.navigateImpl?.(url);
    }
    async attach(): Promise<void> {}
    async send(input: unknown): Promise<void> {
      const entry = runtimeState.get(this.id);
      if (entry?.sendImpl) {
        return entry.sendImpl(input);
      }
    }
    async composePrompt(input: unknown): Promise<void> {
      const entry = runtimeState.get(this.id);
      if (entry?.composeImpl) {
        return entry.composeImpl(input);
      }
    }
    async sendAndWait(): Promise<string> {
      return "compressed";
    }
    async cancel(): Promise<void> {}
    async discoverModels(): Promise<void> {}
    async submitEnter(): Promise<void> {
      const entry = runtimeState.get(this.id);
      if (entry?.submitEnterImpl) {
        return entry.submitEnterImpl();
      }
    }
    async captureAnchor(): Promise<unknown> {
      const entry = runtimeState.get(this.id);
      if (entry?.anchorImpl) {
        return entry.anchorImpl();
      }
      return {
        sequence: 0,
        textSignature: "",
        elementSignature: "mock",
      };
    }
    async recover(): Promise<{ authenticated: boolean; ready: boolean; degraded: boolean; reason?: string }> {
      const entry = runtimeState.get(this.id);
      if (entry?.recoverImpl) {
        return entry.recoverImpl();
      }
      return { authenticated: true, ready: true, degraded: false };
    }
    async syncLatestResponse(): Promise<boolean> {
      const entry = runtimeState.get(this.id);
      if (entry?.syncImpl) {
        return entry.syncImpl();
      }
      return false;
    }
    async listWebConversations(): Promise<WebsiteConversationListSnapshot> {
      return runtimeState.get(this.id)?.historyImpl?.() ?? {
        conversations: [],
        scanRounds: 1,
        partial: false,
      };
    }
    async extractCurrentConversation(): Promise<WebsiteConversationSnapshot> {
      const snapshot = runtimeState.get(this.id)?.snapshotImpl;
      if (!snapshot) throw new Error("No website snapshot configured.");
      return snapshot();
    }
    async getDebugSnapshot(): Promise<unknown> {
      return {};
    }
    async setCleanMode(): Promise<void> {}
    async checkCompletion(): Promise<void> {}
    async clearSiteData(): Promise<{
      authenticated: boolean;
      ready: boolean;
      degraded: boolean;
      reason?: string;
    }> {
      return runtimeState.get(this.id)?.clearImpl?.() ?? {
        authenticated: false,
        ready: false,
        degraded: false,
      };
    }
    setVisible(visible: boolean): void {
      const entry = runtimeState.get(this.id);
      if (entry) entry.visible = visible;
    }
    layout(): void {}
    ownsWebContents(webContents: unknown): boolean {
      return runtimeState.get(this.id)?.ownsImpl?.(webContents) ?? false;
    }
    destroy(): void {}
  },
}));

describe("AppService", () => {
  let database: AppDatabase;
  let AppServiceClass: typeof import("../src/main/app-service").AppService;
  let tempUserDataDir: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    runtimeState.clear();
    ({ AppService: AppServiceClass } = await import("../src/main/app-service"));
    database = new AppDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
    runtimeState.clear();
    if (tempUserDataDir) {
      void rm(tempUserDataDir, { recursive: true, force: true });
      tempUserDataDir = undefined;
    }
    delete process.env.AIHUB_CHATGPT_API_KEY;
    delete process.env.AIHUB_API_KEY;
    delete process.env.AIHUB_TEST_MODE;
    delete process.env.AIHUB_TEST_AUTO_SYNC;
    delete process.env.AIHUB_TEST_HISTORY_FIXTURE;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function windowStub() {
    return {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
        setZoomFactor: vi.fn(),
      },
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    } as unknown as import("electron").BrowserWindow;
  }

  it("marks the user message as failed when provider submission fails before assistant start", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    runtimeState.get("chatgpt")!.sendImpl = async () => {
      throw new Error("submit failed");
    };

    await expect(service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("submit failed");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "failed",
      errorCode: "provider_send_failed",
      failureOrigin: "client",
    });
  });

  it("preserves the confirming-submit phase when provider submit confirmation fails", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    runtimeState.get("chatgpt")!.sendImpl = async () => {
      const emit = runtimeState.get("chatgpt")!.onEvent!;
      emit("chatgpt", {
        type: "generation.failed",
        code: "provider_submit_not_confirmed",
        recoverable: true,
        phase: "confirming-submit",
        detail: "Submission detection failed: composer=true submit=true",
      });
      throw new Error("Submission detection failed: composer=true submit=true");
    };

    await expect(service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("Submission detection failed");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "confirming-submit",
      errorCode: "provider_submit_not_confirmed",
      statusDetail: "Submission detection failed: composer=true submit=true",
      failureOrigin: "client",
    });
    expect(database.getConversation(conversation.id)?.messages).toHaveLength(1);
  });

  it("classifies provider compose failures as typing-message failures", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    runtimeState.get("chatgpt")!.sendImpl = async () => {
      throw new Error("Text entry failed: synthetic composer failure");
    };

    await expect(service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("Text entry failed");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "typing-message",
      errorCode: "provider_compose_failed",
      statusDetail: "Text entry failed: synthetic composer failure",
      failureOrigin: "client",
    });
  });

  it("classifies auth blockers as checking-auth failures", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("doubao");
    runtimeState.get("doubao")!.sendImpl = async () => {
      throw new Error("Login or provider verification is blocking the composer.");
    };

    await expect(service.sendMessage({
      provider: "doubao",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("Login or provider verification is blocking the composer.");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "checking-auth",
      errorCode: "auth_required",
      failureOrigin: "auth",
    });
  });

  it("classifies explicit provider HTTP failures as external", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("qianwen");
    runtimeState.get("qianwen")!.sendImpl = async () => {
      throw new Error("Provider transport returned HTTP 503.");
    };

    await expect(service.sendMessage({
      provider: "qianwen",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("HTTP 503");

    expect(database.getConversation(conversation.id)?.messages[0]).toMatchObject({
      status: "failed",
      errorCode: "provider_external_failure",
      failureOrigin: "external",
    });
    expect(
      service.snapshot().providers.find((provider) => provider.id === "qianwen"),
    ).toMatchObject({
      lastFailureOrigin: "external",
    });
  });

  it("classifies login-required preflight failures as checking-auth failures", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("doubao");
    runtimeState.get("doubao")!.sendImpl = async () => {
      throw new Error("Login or provider verification is required before sending.");
    };

    await expect(service.sendMessage({
      provider: "doubao",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("Login or provider verification is required before sending.");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "checking-auth",
      errorCode: "auth_required",
    });
  });

  it("classifies composer-not-ready preflight failures as checking-auth failures", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    runtimeState.get("chatgpt")!.sendImpl = async () => {
      throw new Error("The provider composer is not ready yet.");
    };

    await expect(service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    })).rejects.toThrow("The provider composer is not ready yet.");

    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "checking-auth",
      errorCode: "auth_required",
      statusDetail: "The provider composer is not ready yet.",
    });
  });

  it("blocks web automation when a provider is switched to the reserved API backend", async () => {
    const service = new AppServiceClass(windowStub(), database);
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "api" },
    });

    await expect(service.createConversation("chatgpt")).rejects.toThrow(
      "API provider backend is reserved but not configured yet.",
    );

    const provider = service
      .snapshot()
      .providers.find((candidate) => candidate.id === "chatgpt");
    expect(provider).toMatchObject({
      authenticated: false,
      ready: false,
      degraded: true,
      reason: "API provider backend is reserved but not configured yet.",
    });
  });

  it("surfaces configured API backends with missing credentials clearly", async () => {
    const service = new AppServiceClass(windowStub(), database);
    delete process.env.AIHUB_CHATGPT_API_KEY;
    delete process.env.AIHUB_API_KEY;
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "api" },
      providerApiConfigs: {
        chatgpt: {
          enabled: true,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1",
        },
      },
    });

    await expect(service.createConversation("chatgpt")).rejects.toThrow(
      "API provider backend requires AIHUB_CHATGPT_API_KEY or AIHUB_API_KEY.",
    );

    expect(
      service.snapshot().providers.find((candidate) => candidate.id === "chatgpt"),
    ).toMatchObject({
      authenticated: false,
      ready: false,
      degraded: true,
      reason: "API provider backend requires AIHUB_CHATGPT_API_KEY or AIHUB_API_KEY.",
    });
  });

  it("keeps diagnostic recovery commands routed through the selected API backend", async () => {
    const service = new AppServiceClass(windowStub(), database);
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "api" },
    });

    await expect(service.syncLatestProviderResponse("chatgpt")).resolves.toBe(false);
    await expect(service.setProviderCleanMode("chatgpt", true)).resolves.toBeUndefined();
    await expect(service.getProviderDebugSnapshot("chatgpt")).resolves.toMatchObject({
      provider: "chatgpt",
      composer: "api",
      submit: "api",
      anchor: "api",
      assistant: "api",
      completionDecision: "API provider backend is reserved but not configured yet.",
      completionSignals: {
        textLength: 0,
        networkIdle: true,
      },
    });
    await expect(service.captureProviderAnchor("chatgpt")).resolves.toMatchObject({
      sequence: 0,
      elementSignature: "api",
    });
  });

  it("captures a provider anchor through the selected backend boundary", async () => {
    const service = new AppServiceClass(windowStub(), database);
    runtimeState.get("chatgpt")!.anchorImpl = async () => ({
      sequence: 3,
      textSignature: "old answer",
      elementSignature: "div:assistant:3",
    });

    await expect(service.captureProviderAnchor("chatgpt")).resolves.toMatchObject({
      sequence: 3,
      textSignature: "old answer",
      elementSignature: "div:assistant:3",
    });
  });

  it("sends through a configured OpenAI-compatible API backend", async () => {
    const service = new AppServiceClass(windowStub(), database);
    process.env.AIHUB_CHATGPT_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "api answer" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "api" },
      providerApiConfigs: {
        chatgpt: {
          enabled: true,
          baseUrl: "https://api.example.test/v1",
          model: "test-model",
        },
      },
    });

    const conversation = await service.createConversation("chatgpt");
    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello api",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json",
        }),
      }),
    );
    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "completed",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: "api answer" }],
    });
    delete process.env.AIHUB_CHATGPT_API_KEY;
  });

  it("finishes the API assistant stream as failed when the request is rejected", async () => {
    const service = new AppServiceClass(windowStub(), database);
    process.env.AIHUB_CHATGPT_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("upstream unavailable", { status: 503 }),
    ));
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "api" },
      providerApiConfigs: {
        chatgpt: {
          enabled: true,
          baseUrl: "https://api.example.test/v1",
          model: "test-model",
        },
      },
    });

    const conversation = await service.createConversation("chatgpt");
    await expect(service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello api",
    })).rejects.toThrow("API provider request failed: 503 upstream unavailable");

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "completed",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "failed",
      statusPhase: "failed",
      errorCode: "provider_api_request_failed",
      statusDetail: "API provider request failed: 503 upstream unavailable",
    });
    delete process.env.AIHUB_CHATGPT_API_KEY;
  });

  it("allows the provider page to open when a provider is switched to manual recovery", async () => {
    const service = new AppServiceClass(windowStub(), database);
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { claude: "manual" },
    });

    await expect(service.setWebsiteVisible("claude", true)).resolves.toBeUndefined();

    const provider = service
      .snapshot()
      .providers.find((candidate) => candidate.id === "claude");
    expect(provider).toMatchObject({
      authenticated: false,
      ready: false,
      degraded: false,
      reason: "Manual provider backend is selected; open the provider page and send manually.",
      websiteVisible: true,
    });
    expect(runtimeState.get("claude")?.visible).toBe(true);
  });

  it("fills the provider composer without submitting when manual recovery is selected", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = database.createConversation({
      id: "manual-conversation",
      title: "Manual Claude",
      provider: "claude",
    });
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { claude: "manual" },
    });
    const composed: unknown[] = [];
    runtimeState.get("claude")!.composeImpl = async (input) => {
      composed.push(input);
    };
    runtimeState.get("claude")!.sendImpl = async () => {
      throw new Error("manual mode should not auto-submit");
    };

    await expect(service.sendMessage({
      provider: "claude",
      conversationId: conversation.id,
      text: "please prepare this",
    })).resolves.toBeUndefined();

    expect(composed).toHaveLength(1);
    expect(composed[0]).toMatchObject({
      conversationId: conversation.id,
      text: "please prepare this",
    });
    const message = database.getConversation(conversation.id)?.messages[0];
    expect(message).toMatchObject({
      role: "user",
      status: "completed",
      statusPhase: "recoverable-blocked",
      statusDetail: "Prompt was filled in the provider page. Review and submit it manually.",
    });
  });

  it("hides the provider page through the ProviderClient ownership boundary", async () => {
    const service = new AppServiceClass(windowStub(), database);
    await service.setWebsiteVisible("chatgpt", true);
    const sender = { id: 1 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;

    service.hideProviderByWebContents(sender as Electron.WebContents);

    expect(runtimeState.get("chatgpt")?.visible).toBe(false);
    expect(
      service.snapshot().providers.find((provider) => provider.id === "chatgpt"),
    ).toMatchObject({ websiteVisible: false });
  });

  it("submits enter through the ProviderClient backend boundary", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const submitEnter = vi.fn(async () => {});
    runtimeState.get("chatgpt")!.submitEnterImpl = submitEnter;

    await service.submitProviderEnter("chatgpt");

    expect(submitEnter).toHaveBeenCalledTimes(1);
  });

  it("resumes a manual provider reply through the monitored web runtime path", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = database.createConversation({
      id: "manual-recovery-conversation",
      title: "Manual Claude Recovery",
      provider: "claude",
    });
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { claude: "manual" },
    });
    runtimeState.get("claude")!.composeImpl = async () => {};
    const emit = runtimeState.get("claude")!.onEvent!;
    const resumedSend = vi.fn(async () => {
      emit("claude", { type: "message.started", messageId: "manual-provider-message" });
      emit("claude", {
        type: "message.snapshot",
        messageId: "manual-provider-message",
        text: "manual recovery answer",
        content: [{ type: "text", text: "manual recovery answer" }],
        phase: "streaming",
      });
      emit("claude", {
        type: "message.completed",
        message: {
          id: "manual-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "manual recovery answer" }],
          status: "completed",
          provider: "claude",
          createdAt: new Date().toISOString(),
        },
      });
    });
    runtimeState.get("claude")!.sendImpl = resumedSend;

    await service.sendMessage({
      provider: "claude",
      conversationId: conversation.id,
      text: "please prepare this",
    });

    await service.submitProviderEnter("claude");

    expect(resumedSend).toHaveBeenCalledWith("");
    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "completed",
      statusPhase: "completed",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: "manual recovery answer" }],
    });
  });

  it("preserves manual retry context when the first unified submit fails before provider monitoring starts", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = database.createConversation({
      id: "manual-retry-conversation",
      title: "Manual Claude Retry",
      provider: "claude",
    });
    service.setSettings({
      ...service.getSettings(),
      providerBackends: { claude: "manual" },
    });
    runtimeState.get("claude")!.composeImpl = async () => {};
    const emit = runtimeState.get("claude")!.onEvent!;
    let attempt = 0;
    runtimeState.get("claude")!.sendImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Login or provider verification is blocking the composer.");
      }
      emit("claude", { type: "message.started", messageId: "manual-retry-provider-message" });
      emit("claude", {
        type: "message.snapshot",
        messageId: "manual-retry-provider-message",
        text: "manual retry answer",
        content: [{ type: "text", text: "manual retry answer" }],
        phase: "streaming",
      });
      emit("claude", {
        type: "message.completed",
        message: {
          id: "manual-retry-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "manual retry answer" }],
          status: "completed",
          provider: "claude",
          createdAt: new Date().toISOString(),
        },
      });
    };

    await service.sendMessage({
      provider: "claude",
      conversationId: conversation.id,
      text: "please retry this",
    });

    await expect(service.submitProviderEnter("claude"))
      .rejects.toThrow("Login or provider verification is blocking the composer.");

    let messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "failed",
      statusPhase: "checking-auth",
      errorCode: "auth_required",
    });
    expect(
      service.snapshot().providers.find((provider) => provider.id === "claude"),
    ).toMatchObject({
      lastFailurePhase: "checking-auth",
      lastFailureCode: "auth_required",
    });

    await expect(service.submitProviderEnter("claude")).resolves.toBeUndefined();

    messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "completed",
      statusPhase: "completed",
      errorCode: undefined,
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: "manual retry answer" }],
    });
    expect(
      service.snapshot().providers.find((provider) => provider.id === "claude"),
    ).toMatchObject({
      lastFailurePhase: undefined,
      lastFailureCode: undefined,
    });
  });

  it("keeps provider events bound to the originating conversation while another chat becomes active", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const first = await service.createConversation("chatgpt");
    const pending: { resolve?: () => void } = {};
    runtimeState.get("chatgpt")!.sendImpl = () =>
      new Promise<void>((resolve) => {
        pending.resolve = resolve;
      });

    const sendPromise = service.sendMessage({
      provider: "chatgpt",
      conversationId: first.id,
      text: "question",
    });
    await Promise.resolve();

    const second = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;
    emit("chatgpt", {
      type: "message.status",
      phase: "submitting",
    });
    emit("chatgpt", {
      type: "generation.failed",
      code: "provider_submission_not_detected",
      recoverable: true,
      phase: "submitting",
    });
    pending.resolve?.();
    await expect(sendPromise).resolves.toBeUndefined();

    expect(database.getConversation(first.id)?.messages[0]).toMatchObject({
      status: "failed",
      statusDetail: undefined,
      errorCode: "provider_submission_not_detected",
    });
    expect(database.getConversation(second.id)?.messages).toHaveLength(0);
  });

  it("does not write back into the database after shutdown cancels an in-flight send", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    runtimeState.get("chatgpt")!.sendImpl = () =>
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Application is closing.")), 0);
      });

    const sendPromise = service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    service.destroy();
    database.close();

    await expect(sendPromise).rejects.toThrow("Application is closing.");
  });

  it("persists structured snapshot and completed assistant content", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "provider-message" });
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "provider-message",
        content: [
          { type: "text", text: "partial answer" },
          { type: "image", src: "https://example.com/chart.png", alt: "chart" },
          {
            type: "math",
            tex: "x^2+y^2",
            display: false,
            source: "katex",
          },
          {
            type: "html",
            kind: "provider-assistant",
            html: "<div><p>partial answer</p></div>",
          },
        ],
        text: "partial answer",
        providerHtml: "<div><p>partial answer</p></div>",
        phase: "streaming",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [
            { type: "text", text: "final answer" },
            { type: "image", src: "https://example.com/chart.png", alt: "chart" },
            {
              type: "math",
              tex: "x^2+y^2",
              display: false,
              source: "katex",
            },
            {
              type: "html",
              kind: "provider-assistant",
              html: "<div><p>final answer</p></div>",
            },
          ],
          providerHtml: "<div><p>final answer</p></div>",
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
    };

    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages[1]?.content).toContainEqual({
      type: "image",
      src: "https://example.com/chart.png",
      alt: "chart",
    });
    expect(messages[1]?.content).toContainEqual({
      type: "math",
      tex: "x^2+y^2",
      display: false,
      source: "katex",
    });
  });

  it("ignores stale provider message events that do not match the active stream", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "active-provider-message" });
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "stale-provider-message",
        text: "stale answer",
        content: [{ type: "text", text: "stale answer" }],
        phase: "streaming",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "stale-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "stale answer" }],
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "active-provider-message",
        text: "current answer",
        content: [{ type: "text", text: "current answer" }],
        phase: "streaming",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "active-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "current answer" }],
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
    };

    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: "current answer" }],
    });
    expect(JSON.stringify(messages)).not.toContain("stale answer");
  });

  it("ignores stale provider failure events that do not match the active stream", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "active-provider-message" });
      emit("chatgpt", {
        type: "generation.failed",
        messageId: "stale-provider-message",
        code: "provider_response_not_detected",
        recoverable: true,
        phase: "waiting-first-token",
        detail: "Stale failure from an older provider send.",
      });
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "active-provider-message",
        text: "current answer after stale failure",
        content: [{ type: "text", text: "current answer after stale failure" }],
        phase: "streaming",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "active-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "current answer after stale failure" }],
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
    };

    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      errorCode: undefined,
      content: [{ type: "text", text: "current answer after stale failure" }],
    });
  });

  it("marks an empty assistant stream as failed when first token detection times out", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "provider-message" });
      emit("chatgpt", {
        type: "generation.failed",
        code: "provider_response_not_detected",
        recoverable: true,
        phase: "waiting-first-token",
        detail: "No assistant response was detected before the provider became idle.",
      });
    };

    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      status: "completed",
      statusPhase: "completed",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "failed",
      statusPhase: "waiting-first-token",
      errorCode: "provider_response_not_detected",
      statusDetail: "No assistant response was detected before the provider became idle.",
    });
  });

  it("persists provider phases emitted after the assistant stream starts", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "provider-message" });
      emit("chatgpt", {
        type: "message.status",
        messageId: "provider-message",
        phase: "binding-assistant",
        detail: "Waiting for an assistant turn after the captured conversation anchor.",
      });
    };

    await service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });

    let assistant = database.getConversation(conversation.id)?.messages[1];
    expect(assistant).toMatchObject({
      role: "assistant",
      status: "streaming",
      statusPhase: "binding-assistant",
      statusDetail: "Waiting for an assistant turn after the captured conversation anchor.",
    });

    emit("chatgpt", {
      type: "message.status",
      messageId: "provider-message",
      phase: "detecting-completion",
      detail: "Assistant text is visible; waiting for it to stabilize.",
    });

    assistant = database.getConversation(conversation.id)?.messages[1];
    expect(assistant).toMatchObject({
      status: "streaming",
      statusPhase: "detecting-completion",
      statusDetail: "Assistant text is visible; waiting for it to stabilize.",
    });
  });

  it("recovers a missed assistant reply through provider sync", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    runtimeState.get("chatgpt")!.syncImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "recovered-provider-message" });
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "recovered-provider-message",
        text: "recovered answer",
        content: [{ type: "text", text: "recovered answer" }],
        providerHtml: "<div>recovered answer</div>",
        phase: "streaming",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "recovered-provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "recovered answer" }],
          providerHtml: "<div>recovered answer</div>",
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
      return true;
    };

    await expect(service.syncLatestProviderResponse("chatgpt")).resolves.toBe(true);

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      status: "completed",
      providerHtml: "<div>recovered answer</div>",
    });
    expect(messages[0]?.content).toEqual([{ type: "text", text: "recovered answer" }]);
  });

  it("resynchronizes the current streaming assistant instead of creating a duplicate", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const conversation = await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;
    const pending: { resolve?: () => void } = {};

    runtimeState.get("chatgpt")!.sendImpl = async () => {
      emit("chatgpt", { type: "message.started", messageId: "provider-message" });
      return new Promise<void>((resolve) => {
        pending.resolve = resolve;
      });
    };
    runtimeState.get("chatgpt")!.syncImpl = async () => {
      emit("chatgpt", {
        type: "message.snapshot",
        messageId: "provider-message",
        text: "resynced active answer",
        content: [{ type: "text", text: "resynced active answer" }],
        providerHtml: "<div>resynced active answer</div>",
        phase: "streaming",
        detail: "Recovered from provider page.",
      });
      emit("chatgpt", {
        type: "message.completed",
        message: {
          id: "provider-message",
          conversationId: conversation.id,
          role: "assistant",
          content: [{ type: "text", text: "resynced active answer" }],
          providerHtml: "<div>resynced active answer</div>",
          status: "completed",
          provider: "chatgpt",
          createdAt: new Date().toISOString(),
        },
      });
      return true;
    };

    const sendPromise = service.sendMessage({
      provider: "chatgpt",
      conversationId: conversation.id,
      text: "hello",
    });
    await Promise.resolve();

    expect(database.getConversation(conversation.id)?.messages).toHaveLength(2);
    await expect(service.syncLatestProviderResponse("chatgpt")).resolves.toBe(true);
    pending.resolve?.();
    await expect(sendPromise).resolves.toBeUndefined();

    const messages = database.getConversation(conversation.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "completed",
      providerHtml: "<div>resynced active answer</div>",
      content: [{ type: "text", text: "resynced active answer" }],
    });
  });

  it("records diagnostic provider event details for later debugging", async () => {
    const service = new AppServiceClass(windowStub(), database);
    await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    emit("chatgpt", {
      type: "message.anchor-captured",
      messageId: "provider-message",
      detail: "div:assistant:3",
    });
    emit("chatgpt", {
      type: "message.assistant-bound",
      messageId: "provider-message",
      detail: "bound-after-anchor:3->4",
    });
    emit("chatgpt", {
      type: "provider.network-idle",
      url: "https://chatgpt.com/backend-api/conversation",
    });
    emit("chatgpt", {
      type: "provider.debug-snapshot",
      snapshot: {
        provider: "chatgpt",
        url: "https://chatgpt.com/c/123",
        composer: "textarea visible=true text=0",
        submit: "button visible=true text=4",
        anchor: "div:assistant:3",
        assistant: "div visible=true text=42",
        activeMessageId: "provider-message",
        assistantBinding: "bound-after-anchor:3->4",
        latestTextLength: 42,
        isGenerating: false,
        networkActiveCount: 0,
        networkIdle: true,
        lastNetworkUrl: "https://chatgpt.com/backend-api/conversation",
        lastMutationAt: 123,
        completionDecision: "complete",
        completionSignals: {
          textLength: 42,
          hasStopButton: false,
          hasStreamingIndicator: false,
          networkIdle: true,
          hasRecoverableBlocker: false,
          stableMs: 3000,
          elapsedMs: 5000,
        },
        fallbackUsed: false,
      },
    });

    const details = database
      .listAdapterEvents("chatgpt", 10)
      .map((event) => event.detail ?? "")
      .join("\n");
    expect(details).toContain("div:assistant:3");
    expect(details).toContain("bound-after-anchor:3->4");
    expect(details).toContain("backend-api/conversation");
    expect(details).toContain("\"activeMessageId\":\"provider-message\"");
    expect(details).toContain("\"completionDecision\":\"complete\"");
  });

  it("reopens a degraded web provider through the recovery path and clears provider failure state", async () => {
    const service = new AppServiceClass(windowStub(), database);
    await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    emit("chatgpt", {
      type: "adapter.degraded",
      reason: "The provider send button could not be located.",
    });
    emit("chatgpt", {
      type: "generation.failed",
      code: "provider_submit_not_found",
      recoverable: true,
      phase: "submitting",
      detail: "Provider send button not found.",
    });

    runtimeState.get("chatgpt")!.recoverImpl = async () => ({
      authenticated: true,
      ready: true,
      degraded: false,
    });

    await expect(service.recoverProvider("chatgpt")).resolves.toMatchObject({
      id: "chatgpt",
      authenticated: true,
      ready: true,
      degraded: false,
      lastFailurePhase: undefined,
      lastFailureCode: undefined,
    });

    await expect(service.setWebsiteVisible("chatgpt", true)).resolves.toBeUndefined();

    const provider = service.snapshot().providers.find((entry) => entry.id === "chatgpt");
    expect(provider).toMatchObject({
      authenticated: true,
      ready: true,
      degraded: false,
      websiteVisible: true,
      lastFailurePhase: undefined,
      lastFailureCode: undefined,
    });
  });

  it("keeps a debug snapshot next to provider failures in adapter events", async () => {
    const service = new AppServiceClass(windowStub(), database);
    await service.createConversation("chatgpt");
    const emit = runtimeState.get("chatgpt")!.onEvent!;

    emit("chatgpt", {
      type: "provider.debug-snapshot",
      snapshot: {
        provider: "chatgpt",
        url: "https://chatgpt.com/c/123",
        composer: "textarea visible=true text=21",
        submit: "button visible=true text=4",
        anchor: "div:assistant:3",
        assistant: "none",
        activeMessageId: undefined,
        assistantBinding: "none",
        latestTextLength: 0,
        isGenerating: false,
        networkActiveCount: 0,
        networkIdle: true,
        lastNetworkUrl: undefined,
        lastMutationAt: 456,
        completionDecision: "fail code=provider_submit_not_confirmed phase=confirming-submit",
        completionSignals: {
          textLength: 0,
          hasStopButton: false,
          hasStreamingIndicator: false,
          networkIdle: true,
          hasRecoverableBlocker: false,
          stableMs: 0,
          elapsedMs: 0,
        },
        fallbackUsed: false,
      },
    });
    emit("chatgpt", {
      type: "generation.failed",
      code: "provider_submit_not_confirmed",
      recoverable: true,
      phase: "confirming-submit",
      detail: "Submission detection failed.",
    });

    const events = database.listAdapterEvents("chatgpt", 2);
    expect(events.map((event) => event.type)).toEqual([
      "generation.failed",
      "provider.debug-snapshot",
    ]);
    expect(events[1]?.detail).toContain("provider_submit_not_confirmed");
    expect(events[0]?.detail).toContain("confirming-submit");
  });

  it("ignores smoke results from a different runtime instance", async () => {
    tempUserDataDir = await mkdtemp(path.join(os.tmpdir(), "aihub-app-service-smoke-"));
    const diagnosticsDir = path.join(tempUserDataDir, "diagnostics");
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(
      path.join(diagnosticsDir, "runtime-info.json"),
      JSON.stringify({
        instanceId: "current-runtime",
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(diagnosticsDir, "provider-smoke-chatgpt.json"),
      JSON.stringify({
        provider: "chatgpt",
        runtime: {
          instanceId: "old-runtime",
          pid: 1234,
          startedAt: "2026-07-10T00:00:00.000Z",
        },
        diagnostics: {
          adapterEvents: [],
        },
      }, null, 2),
      "utf8",
    );

    const service = new AppServiceClass(windowStub(), database, tempUserDataDir);
    await expect(service.getProviderSmokeInspection("chatgpt")).resolves.toMatchObject({
      provider: "chatgpt",
      status: "stale",
      staleRuntimeInstanceId: "old-runtime",
      currentRuntime: {
        instanceId: "current-runtime",
      },
    });
    await expect(service.getLatestProviderSmokeResult("chatgpt")).resolves.toBeUndefined();
  });

  it("imports website history idempotently and normalizes conversation URLs", async () => {
    const service = new AppServiceClass(windowStub(), database);
    runtimeState.get("chatgpt")!.historyImpl = async () => ({
      conversations: [{
        externalId: "remote-1",
        title: "Remote conversation",
        url: "https://chatgpt.com/c/remote-1/?utm_source=test#latest",
        isActive: true,
      }],
      scanRounds: 2,
      partial: false,
    });
    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "remote-1",
      title: "Remote conversation",
      url: "https://chatgpt.com/c/remote-1",
      messages: [],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });

    await expect(service.syncWebHistory("chatgpt")).resolves.toMatchObject({
      discovered: 1,
      created: 1,
      partial: false,
    });
    await expect(service.syncWebHistory("chatgpt")).resolves.toMatchObject({
      discovered: 1,
      created: 0,
      updated: 1,
    });
    expect(database.listConversations()).toHaveLength(1);
    expect(database.listConversations()[0]?.externalId).toBe(
      "https://chatgpt.com/c/remote-1",
    );
  });

  it("emits the local snapshot before startup website history sync completes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    database.setSettings({
      autoSyncWebHistory: true,
      providerBackends: {
        chatgpt: "web",
        claude: "manual",
        doubao: "manual",
        kimi: "manual",
        deepseek: "manual",
        hunyuan: "manual",
        qianwen: "manual",
      },
    });
    database.createConversation({
      id: "local-before-sync",
      title: "Local before sync",
      provider: "chatgpt",
    });
    const window = windowStub();
    const service = new AppServiceClass(window, database);
    let releaseHistory: (() => void) | undefined;
    let markHistoryStarted: (() => void) | undefined;
    const historyStarted = new Promise<void>((resolve) => {
      markHistoryStarted = resolve;
    });
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    runtimeState.get("chatgpt")!.historyImpl = async () => {
      markHistoryStarted?.();
      await historyGate;
      return {
        conversations: [{
          externalId: "startup-remote",
          title: "Startup remote",
          url: "https://chatgpt.com/c/startup-remote",
          isActive: true,
        }],
        scanRounds: 1,
        partial: false,
      };
    };
    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "startup-remote",
      title: "Startup remote",
      url: "https://chatgpt.com/c/startup-remote",
      messages: [{
        key: "startup-user",
        role: "user",
        order: 0,
        content: [{ type: "text", text: "Startup question" }],
      }],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });

    await service.initialize();
    const send = window.webContents.send as unknown as ReturnType<typeof vi.fn>;
    expect(send.mock.calls[0]?.[0]).toBe("app:snapshot");
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      conversations: [expect.objectContaining({ id: "local-before-sync" })],
    });
    await historyStarted;
    expect(database.listConversations()).toHaveLength(1);

    releaseHistory?.();
    await vi.waitFor(() => {
      expect(database.listConversations()).toHaveLength(2);
      expect(database.getConversationByExternalId(
        "chatgpt",
        "https://chatgpt.com/c/startup-remote",
      )?.messages).toHaveLength(1);
    });
    service.destroy();
  });

  it("limits startup website history sync to two providers and isolates failures", async () => {
    vi.stubEnv("NODE_ENV", "production");
    database.setSettings({ autoSyncWebHistory: true });
    const service = new AppServiceClass(windowStub(), database);
    let active = 0;
    let maximumActive = 0;
    const calls: string[] = [];
    for (const [provider, entry] of runtimeState) {
      entry.historyImpl = async () => {
        calls.push(provider);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (provider === "chatgpt") {
            throw new Error("isolated startup failure");
          }
          return {
            conversations: [],
            scanRounds: 1,
            partial: false,
          };
        } finally {
          active -= 1;
        }
      };
    }

    await service.initialize();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(7);
    });
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(calls).toEqual(expect.arrayContaining([
      "chatgpt",
      "claude",
      "doubao",
      "kimi",
      "deepseek",
      "hunyuan",
      "qianwen",
    ]));
    service.destroy();
  });

  it("does not persist startup history after shutdown closes the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    database.setSettings({
      autoSyncWebHistory: true,
      providerBackends: {
        chatgpt: "web",
        claude: "manual",
        doubao: "manual",
        kimi: "manual",
        deepseek: "manual",
        hunyuan: "manual",
        qianwen: "manual",
      },
    });
    const service = new AppServiceClass(windowStub(), database);
    let releaseHistory: (() => void) | undefined;
    let markHistoryStarted: (() => void) | undefined;
    let markHistoryReturned: (() => void) | undefined;
    const historyStarted = new Promise<void>((resolve) => {
      markHistoryStarted = resolve;
    });
    const historyReturned = new Promise<void>((resolve) => {
      markHistoryReturned = resolve;
    });
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    runtimeState.get("chatgpt")!.historyImpl = async () => {
      markHistoryStarted?.();
      await historyGate;
      markHistoryReturned?.();
      return {
        conversations: [{
          externalId: "must-not-persist",
          title: "Must not persist",
          url: "https://chatgpt.com/c/must-not-persist",
        }],
        scanRounds: 1,
        partial: false,
      };
    };
    const createConversation = vi.spyOn(database, "createConversation");
    const setSyncState = vi.spyOn(database, "setConversationSyncState");

    await service.initialize();
    await historyStarted;
    service.destroy();
    database.close();
    releaseHistory?.();
    await historyReturned;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(createConversation).not.toHaveBeenCalled();
    expect(setSyncState).not.toHaveBeenCalled();
  });

  it("syncs the current provider conversation from its owned page without duplicates", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const sender = { id: 41 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;
    let assistantText = "First answer";
    let snapshotCalls = 0;
    runtimeState.get("chatgpt")!.snapshotImpl = async () => {
      snapshotCalls += 1;
      return {
        externalId: "current-1",
        title: "Current website chat",
        url: "https://chatgpt.com/c/current-1?utm_source=test#latest",
        messages: [
          {
            key: "user-1",
            role: "user",
            order: 0,
            content: [{ type: "text", text: "Hello website" }],
          },
          {
            key: "assistant-1",
            role: "assistant",
            order: 1,
            content: [{ type: "text", text: assistantText }],
          },
        ],
        scanRounds: 1,
        partial: false,
        limitReached: false,
      };
    };

    const [first, concurrent] = await Promise.all([
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ]);

    expect(first).toMatchObject({
      provider: "chatgpt",
      created: true,
      syncedMessages: 2,
      partial: false,
    });
    expect(concurrent).toEqual(first);
    expect(snapshotCalls).toBe(1);
    expect(database.listConversations()).toHaveLength(1);

    assistantText = "Updated answer";
    const second = await service.syncCurrentWebsiteConversationByWebContents(
      sender as Electron.WebContents,
    );

    expect(second).toMatchObject({
      conversationId: first.conversationId,
      created: false,
      syncedMessages: 2,
    });
    const synchronized = database.getConversation(first.conversationId);
    expect(synchronized?.externalId).toBe(
      "https://chatgpt.com/c/current-1",
    );
    expect(synchronized?.messages).toHaveLength(2);
    expect(synchronized?.messages[1]?.content).toEqual([
      { type: "text", text: "Updated answer" },
    ]);
  });

  it("does not bind a directly opened website chat to an unrelated active local chat", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const local = database.createConversation({
      id: "unbound-local",
      title: "Unrelated local chat",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "unrelated-user",
      conversationId: local.id,
      role: "user",
      content: [{ type: "text", text: "Different local prompt" }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    await service.selectConversation(local.id);
    const sender = { id: 42 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;
    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "website-chat",
      title: "Website chat",
      url: "https://chatgpt.com/c/website-chat",
      messages: [{
        key: "website-user",
        role: "user",
        order: 0,
        content: [{ type: "text", text: "A different website prompt" }],
      }],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });

    const result = await service.syncCurrentWebsiteConversationByWebContents(
      sender as Electron.WebContents,
    );

    expect(result.created).toBe(true);
    expect(result.conversationId).not.toBe(local.id);
    expect(database.getConversation(local.id)?.externalId).toBeUndefined();
    expect(database.listConversations()).toHaveLength(2);
  });

  it("rejects unmanaged, signed-out, and empty provider pages without creating conversations", async () => {
    const service = new AppServiceClass(windowStub(), database);
    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        { id: 99 } as Electron.WebContents,
      ),
    ).rejects.toThrow("managed provider page");

    const sender = { id: 43 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;
    runtimeState.get("chatgpt")!.detectImpl = async () => ({
      authenticated: false,
      ready: false,
      degraded: false,
      reason: "Sign in first.",
    });
    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ).rejects.toThrow("Sign in first");

    runtimeState.get("chatgpt")!.detectImpl = async () => ({
      authenticated: true,
      ready: true,
      degraded: false,
    });
    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "https://chatgpt.com/",
      title: "ChatGPT",
      url: "https://chatgpt.com/",
      messages: [{
        key: "homepage-message",
        role: "assistant",
        order: 0,
        content: [{ type: "text", text: "Homepage content" }],
      }],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });
    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ).rejects.toThrow("Open a saved provider conversation");

    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "empty-chat",
      title: "Empty website chat",
      url: "https://chatgpt.com/c/empty-chat",
      messages: [],
      scanRounds: 1,
      partial: false,
      limitReached: false,
      fallbackReason: "no-semantic-message-elements",
    });
    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ).rejects.toThrow("No conversation messages were found");
    expect(database.listConversations()).toHaveLength(0);

    service.setSettings({
      ...service.getSettings(),
      providerBackends: { chatgpt: "manual" },
    });
    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ).rejects.toThrow("Manual provider backend is selected");
  });

  it("keeps existing content and marks it failed when current page extraction is empty", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const existing = database.createConversation({
      id: "existing-website-chat",
      title: "Existing website chat",
      provider: "chatgpt",
      externalId: "https://chatgpt.com/c/existing-website-chat",
    });
    database.addMessage({
      id: "existing-message",
      conversationId: existing.id,
      role: "assistant",
      content: [{ type: "text", text: "Keep this answer" }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    const sender = { id: 44 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;
    runtimeState.get("chatgpt")!.snapshotImpl = async () => ({
      externalId: "existing-website-chat",
      title: "Existing website chat",
      url: "https://chatgpt.com/c/existing-website-chat",
      messages: [],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });

    await expect(
      service.syncCurrentWebsiteConversationByWebContents(
        sender as Electron.WebContents,
      ),
    ).rejects.toThrow("No conversation messages were found");

    expect(database.getConversation(existing.id)).toMatchObject({
      syncStatus: "error",
      syncError: "No conversation messages were found on the current provider page.",
      messages: [expect.objectContaining({ id: "existing-message" })],
    });
  });

  it("serializes a full history scan behind an in-flight current conversation sync", async () => {
    const service = new AppServiceClass(windowStub(), database);
    const sender = { id: 45 };
    runtimeState.get("chatgpt")!.ownsImpl = (candidate) => candidate === sender;
    let releaseSnapshot: ((snapshot: WebsiteConversationSnapshot) => void) | undefined;
    let markSnapshotStarted: (() => void) | undefined;
    const snapshotStarted = new Promise<void>((resolve) => {
      markSnapshotStarted = resolve;
    });
    const snapshotGate = new Promise<WebsiteConversationSnapshot>((resolve) => {
      releaseSnapshot = resolve;
    });
    runtimeState.get("chatgpt")!.snapshotImpl = async () => {
      markSnapshotStarted?.();
      return snapshotGate;
    };
    let historyCalls = 0;
    runtimeState.get("chatgpt")!.historyImpl = async () => {
      historyCalls += 1;
      return {
        conversations: [],
        scanRounds: 1,
        partial: false,
      };
    };

    const currentSync = service.syncCurrentWebsiteConversationByWebContents(
      sender as Electron.WebContents,
    );
    await snapshotStarted;
    const historySync = service.syncWebHistory("chatgpt");
    await Promise.resolve();
    expect(historyCalls).toBe(0);

    releaseSnapshot?.({
      externalId: "serialized-chat",
      title: "Serialized chat",
      url: "https://chatgpt.com/c/serialized-chat",
      messages: [{
        key: "serialized-user",
        role: "user",
        order: 0,
        content: [{ type: "text", text: "Serialized prompt" }],
      }],
      scanRounds: 1,
      partial: false,
      limitReached: false,
    });
    await expect(currentSync).resolves.toMatchObject({
      provider: "chatgpt",
      syncedMessages: 1,
    });
    await expect(historySync).resolves.toMatchObject({
      provider: "chatgpt",
      discovered: 0,
    });
    expect(historyCalls).toBe(1);
  });

  it("only marks missing website conversations after two complete scans", async () => {
    const service = new AppServiceClass(windowStub(), database);
    database.createConversation({
      id: "remote-missing",
      title: "Remote",
      provider: "chatgpt",
      externalId: "https://chatgpt.com/c/missing",
    });
    let partial = false;
    runtimeState.get("chatgpt")!.historyImpl = async () => ({
      conversations: [],
      scanRounds: 2,
      partial,
    });

    await service.syncWebHistory("chatgpt");
    expect(database.getConversation("remote-missing")?.syncStatus).not.toBe(
      "remote-missing",
    );
    partial = true;
    await service.syncWebHistory("chatgpt");
    expect(database.getConversation("remote-missing")?.remoteMissingCount).toBe(1);
    partial = false;
    await service.syncWebHistory("chatgpt");
    expect(database.getConversation("remote-missing")).toMatchObject({
      syncStatus: "remote-missing",
      remoteMissingCount: 2,
    });
  });

  it("returns smoke results that match the current runtime instance", async () => {
    tempUserDataDir = await mkdtemp(path.join(os.tmpdir(), "aihub-app-service-smoke-"));
    const diagnosticsDir = path.join(tempUserDataDir, "diagnostics");
    const startedAt = new Date().toISOString();
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(
      path.join(diagnosticsDir, "runtime-info.json"),
      JSON.stringify({
        instanceId: "current-runtime",
        pid: process.pid,
        startedAt,
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(diagnosticsDir, "provider-smoke-chatgpt.json"),
      `\uFEFF${JSON.stringify({
        provider: "chatgpt",
        runtime: {
          instanceId: "current-runtime",
          pid: process.pid,
          startedAt,
        },
        diagnostics: {
          adapterEvents: [],
        },
      }, null, 2)}`,
      "utf8",
    );

    const service = new AppServiceClass(windowStub(), database, tempUserDataDir);
    await expect(service.getProviderSmokeInspection("chatgpt")).resolves.toMatchObject({
      provider: "chatgpt",
      status: "matched",
      currentRuntime: {
        instanceId: "current-runtime",
      },
      result: {
        provider: "chatgpt",
      },
    });
    await expect(service.getLatestProviderSmokeResult("chatgpt")).resolves.toMatchObject({
      provider: "chatgpt",
      runtime: {
        instanceId: "current-runtime",
      },
    });
  });

  it("previews a settings import without mutating stored settings", () => {
    const service = new AppServiceClass(windowStub(), database);
    service.setSettings({ theme: "light", locale: "en-US" });

    const preview = service.previewSettingsImport(
      JSON.stringify({
        theme: "dark",
        futureSetting: true,
        providerOrder: ["future-provider", "claude"],
      }),
    );

    expect(preview.candidate.theme).toBe("dark");
    expect(preview.ignoredKeys).toEqual(["futureSetting"]);
    expect(preview.candidate.providerOrder?.[0]).toBe("claude");
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unsupported settings"),
        expect.stringContaining("future-provider"),
      ]),
    );
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "theme", before: "light", after: "dark" }),
      ]),
    );
    expect(service.getSettings().theme).toBe("light");
  });

  it("repairs unknown provider IDs while loading persisted settings", () => {
    database.setSettings({
      defaultProvider: "future-provider",
      providerOrder: ["future-provider", "claude", "claude"],
      enabledProviders: ["future-provider", "claude"],
    } as unknown as import("@aihub/core").AppSettingsPayload);
    const service = new AppServiceClass(windowStub(), database);

    expect(service.getSettings()).toMatchObject({
      defaultProvider: "claude",
      enabledProviders: ["claude"],
    });
    expect(service.getSettings().providerOrder?.[0]).toBe("claude");
  });

  it("exports versioned data without attachment local paths", async () => {
    tempUserDataDir = await mkdtemp(
      path.join(os.tmpdir(), "aihub-app-service-export-"),
    );
    const destination = path.join(tempUserDataDir, "aihub-data.json");
    const { dialog } = await import("electron");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: destination,
    });
    database.createConversation({
      id: "private-export",
      title: "Private export",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "private-message",
      conversationId: "private-export",
      role: "user",
      content: [
        {
          type: "attachment",
          name: "C:\\Users\\person\\private.txt",
          localPath: "C:\\Users\\person\\private.txt",
        },
        {
          type: "html",
          html: '<img src="file:///C:/Users/person/private.png">',
          kind: "provider-assistant",
        },
      ],
      providerHtml:
        '<div data-provider-session="private">Provider-only markup</div>',
      status: "streaming",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    const service = new AppServiceClass(
      windowStub(),
      database,
      tempUserDataDir,
    );

    await expect(service.exportAllData()).resolves.toMatchObject({
      canceled: false,
      path: destination,
      conversationCount: 1,
      messageCount: 1,
    });
    const exported = await readFile(destination, "utf8");
    expect(exported).toContain('"format": "aihub-data"');
    expect(exported).not.toContain("localPath");
    expect(exported).not.toContain("C:\\\\Users");
    expect(exported).not.toContain("file:///");
    expect(exported).not.toContain("data-provider-session");
    expect(exported).not.toContain("Provider-only markup");
    expect(JSON.parse(exported).conversations[0].messages[0]).toMatchObject({
      status: "failed",
      statusPhase: "failed",
      errorCode: "exported_incomplete_message",
      failureOrigin: "client",
    });
  });

  it("does not write data when the export dialog is canceled", async () => {
    const { dialog } = await import("electron");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: "",
    });
    const service = new AppServiceClass(windowStub(), database);

    await expect(service.exportAllData()).resolves.toEqual({ canceled: true });
  });

  it("reports storage metrics from SQLite", async () => {
    tempUserDataDir = await mkdtemp(
      path.join(os.tmpdir(), "aihub-app-service-storage-"),
    );
    database.createConversation({
      id: "storage-conversation",
      title: "Storage",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "storage-message",
      conversationId: "storage-conversation",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    const service = new AppServiceClass(
      windowStub(),
      database,
      tempUserDataDir,
    );

    await expect(service.getStorageSummary()).resolves.toMatchObject({
      userDataPath: tempUserDataDir,
      databaseBytes: 0,
      conversationCount: 1,
      messageCount: 1,
      documentCount: 0,
    });
  });

  it("does not leave a partial export when writing fails", async () => {
    tempUserDataDir = await mkdtemp(
      path.join(os.tmpdir(), "aihub-app-service-export-failure-"),
    );
    const destination = path.join(
      tempUserDataDir,
      "missing",
      "aihub-data.json",
    );
    const { dialog } = await import("electron");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: destination,
    });
    const service = new AppServiceClass(
      windowStub(),
      database,
      tempUserDataDir,
    );

    await expect(service.exportAllData()).rejects.toThrow();
    await expect(readFile(destination, "utf8")).rejects.toThrow();
  });

  it("requires a fresh preview when a portable import file changes", async () => {
    tempUserDataDir = await mkdtemp(
      path.join(os.tmpdir(), "aihub-app-service-import-"),
    );
    const source = path.join(tempUserDataDir, "aihub-data.json");
    const timestamp = "2026-07-26T00:00:00.000Z";
    const payload = {
      format: "aihub-data",
      version: 1,
      appVersion: "0.1.0",
      exportedAt: timestamp,
      conversations: [],
      folders: [],
      tags: [],
      systemPrompts: [],
      documents: [],
    };
    await writeFile(source, JSON.stringify(payload), "utf8");
    const { dialog } = await import("electron");
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [source],
    });
    const service = new AppServiceClass(
      windowStub(),
      database,
      tempUserDataDir,
    );

    const preview = await service.previewDataImport();
    expect(preview).toMatchObject({
      canceled: false,
      fileName: "aihub-data.json",
      conversationCount: 0,
    });
    await writeFile(
      source,
      JSON.stringify({ ...payload, appVersion: "changed" }),
      "utf8",
    );

    await expect(service.importAllData(preview.token!)).rejects.toThrow(
      /changed after preview/i,
    );
    await expect(service.importAllData(preview.token!)).rejects.toThrow(
      /preview expired/i,
    );
  });

  it("creates a pre-reset backup and only then clears local content", async () => {
    tempUserDataDir = await mkdtemp(
      path.join(os.tmpdir(), "aihub-app-service-reset-"),
    );
    const requestRestart = vi.fn();
    database.createConversation({
      id: "reset-conversation",
      title: "Back me up",
      provider: "chatgpt",
    });
    const service = new AppServiceClass(
      windowStub(),
      database,
      tempUserDataDir,
      { requestRestart },
    );

    const result = await service.resetData({
      scope: "local-content",
      confirmation: "LLM Workbench",
      createBackup: true,
    });

    expect(result).toMatchObject({
      scheduledRestart: true,
      backupId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
    expect(database.listConversations(true)).toEqual([]);
    await expect(service.listBackups()).resolves.toMatchObject([
      {
        id: result.backupId,
        reason: "pre-reset",
        conversationCount: 1,
      },
    ]);
    await vi.waitFor(() => expect(requestRestart).toHaveBeenCalledOnce());
  });

  it("clears only the requested provider site partition", async () => {
    const service = new AppServiceClass(windowStub(), database);
    let clearedProvider: string | undefined;
    runtimeState.get("claude")!.clearImpl = async () => {
      clearedProvider = "claude";
      return { authenticated: false, ready: false, degraded: false };
    };
    runtimeState.get("chatgpt")!.clearImpl = async () => {
      throw new Error("The wrong provider was cleared.");
    };

    await expect(service.clearProviderSiteData("claude")).resolves.toMatchObject({
      id: "claude",
      authenticated: false,
      ready: false,
    });
    expect(clearedProvider).toBe("claude");
  });
});
