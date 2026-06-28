import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/main/database";

const runtimeState = new Map<string, {
  sendImpl?: (input: unknown) => Promise<void>;
  onEvent?: (provider: string, event: unknown) => void;
}>();

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
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
      return { authenticated: true, ready: true, degraded: false };
    }
    async createConversation(): Promise<void> {}
    async attach(): Promise<void> {}
    async send(input: unknown): Promise<void> {
      const entry = runtimeState.get(this.id);
      if (entry?.sendImpl) {
        return entry.sendImpl(input);
      }
    }
    async sendAndWait(): Promise<string> {
      return "compressed";
    }
    async cancel(): Promise<void> {}
    async discoverModels(): Promise<void> {}
    setVisible(): void {}
    layout(): void {}
    destroy(): void {}
  },
}));

describe("AppService", () => {
  let database: AppDatabase;
  let AppServiceClass: typeof import("../src/main/app-service").AppService;

  beforeEach(async () => {
    vi.resetModules();
    runtimeState.clear();
    ({ AppService: AppServiceClass } = await import("../src/main/app-service"));
    database = new AppDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
    runtimeState.clear();
  });

  function windowStub() {
    return {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
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
});
