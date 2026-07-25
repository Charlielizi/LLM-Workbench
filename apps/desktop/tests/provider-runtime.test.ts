import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const sentCommands: unknown[] = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const webRequestHandlers = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      handlers.set(channel, handler);
    }),
    loadURL: vi.fn(() => Promise.resolve()),
    send: vi.fn((channel: string, command: { requestId?: string; type?: string }) => {
      sentCommands.push(command);
      if (channel === "provider:command" && command.requestId) {
        const value = command.type === "detect-state"
          ? { authenticated: true, ready: true, degraded: false }
          : command.type === "configure-mode"
            ? { available: false, enabled: false }
            : command.type === "prepare-trusted-send"
              ? {
                  action: "composer",
                  inputMethod: "text",
                  x: 100,
                  y: 100,
                  width: 300,
                  height: 60,
                  elementType: "textarea",
                  fingerprint: "composer-fixture",
                }
              : command.type === "verify-trusted-input"
                ? {
                    matched: true,
                    actualLength: 5,
                    expectedLength: 5,
                    actualHash: "fnv1a-test",
                    expectedHash: "fnv1a-test",
                    fingerprint: "composer-fixture",
                  }
                : command.type === "arm-trusted-send"
                  ? {
                      action: "submit",
                      inputMethod: "click",
                      x: 450,
                      y: 100,
                      width: 40,
                      height: 40,
                      elementType: "button",
                      fingerprint: "submit-fixture",
                    }
                  : command.type === "confirm-trusted-submit"
                    ? {
                        confirmed: true,
                        userTurnSeen: true,
                        transportSeen: false,
                        assistantStarted: false,
                        sessionCreated: false,
                        retryAllowed: false,
                        currentConversationId: "conversation-fixture",
                      }
            : command.type === "sync-latest-response"
              ? true
              : undefined;
        handlers.get("ipc-message")?.(
          {},
          `provider:response:${command.requestId}`,
          {
            ok: true,
            value,
          },
        );
      }
    }),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    debugger: {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      sendCommand: vi.fn(),
    },
  };
  const view = {
    webContents,
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ width: 800, height: 600 })),
  };
  const webRequest = {
    onBeforeRequest: vi.fn(
      (_filter: unknown, handler: (...args: unknown[]) => void) =>
        webRequestHandlers.set("before", handler),
    ),
    onResponseStarted: vi.fn(
      (_filter: unknown, handler: (...args: unknown[]) => void) =>
        webRequestHandlers.set("headers", handler),
    ),
    onCompleted: vi.fn(
      (_filter: unknown, handler: (...args: unknown[]) => void) =>
        webRequestHandlers.set("completed", handler),
    ),
    onErrorOccurred: vi.fn(
      (_filter: unknown, handler: (...args: unknown[]) => void) =>
        webRequestHandlers.set("failed", handler),
    ),
  };
  const providerSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest,
    clearStorageData: vi.fn(() => Promise.resolve()),
    clearCache: vi.fn(() => Promise.resolve()),
  };
  return {
    sentCommands,
    handlers,
    webContents,
    view,
    webRequest,
    webRequestHandlers,
    providerSession,
  };
});

vi.mock("electron", () => ({
  session: {
    fromPartition: vi.fn(() => electronMock.providerSession),
  },
  shell: { openExternal: vi.fn() },
  WebContentsView: vi.fn(() => electronMock.view),
}));

describe("ProviderRuntime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    electronMock.sentCommands.length = 0;
    electronMock.handlers.clear();
    electronMock.webRequestHandlers.clear();
    vi.clearAllMocks();
  });

  function windowStub() {
    return {
      isDestroyed: () => false,
      getContentSize: () => [1200, 800],
      webContents: {
        focus: vi.fn(),
      },
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
    } as unknown as import("electron").BrowserWindow;
  }

  function completedMessage() {
    const now = new Date().toISOString();
    return {
      id: "assistant-1",
      conversationId: "conversation-1",
      provider: "chatgpt" as const,
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "done" }],
      status: "completed" as const,
      createdAt: now,
      updatedAt: now,
    };
  }

  it("forwards completion checks to the provider preload", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.checkCompletion();

    expect(electronMock.sentCommands).toContainEqual(
      expect.objectContaining({ type: "check-completion" }),
    );
  });

  it("clears only its provider partition and reloads the sign-in page", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "claude",
      onEvent: vi.fn(),
    });

    await expect(runtime.clearSiteData()).resolves.toMatchObject({
      authenticated: false,
      ready: false,
      degraded: false,
    });
    expect(electronMock.providerSession.clearStorageData).toHaveBeenCalledOnce();
    expect(electronMock.providerSession.clearCache).toHaveBeenCalledOnce();
    expect(electronMock.webContents.loadURL).toHaveBeenCalledWith(
      expect.stringContaining("claude.ai"),
    );
  });

  it("tracks worker transport through the provider partition without retaining request bodies", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const onEvent = vi.fn();
    new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "chatgpt",
      onEvent,
    });
    const callback = vi.fn();
    electronMock.webRequestHandlers.get("before")?.(
      {
        id: 42,
        url: "https://chatgpt.com/backend-api/conversation?token=secret",
        method: "POST",
        resourceType: "sharedWorker",
        uploadData: [{ bytes: Buffer.from('{"prompt":"hello"}') }],
      },
      callback,
    );
    electronMock.webRequestHandlers.get("headers")?.({
      id: 42,
      statusCode: 200,
    });
    electronMock.webRequestHandlers.get("completed")?.({
      id: 42,
      statusCode: 200,
    });

    expect(callback).toHaveBeenCalledWith({});
    expect(onEvent).toHaveBeenCalledWith(
      "chatgpt",
      expect.objectContaining({
        type: "provider.transport",
        event: expect.objectContaining({
          phase: "started",
          urlPath: "https://chatgpt.com/backend-api/conversation",
          resourceType: "sharedWorker",
          uploadBytes: 18,
          uploadHash: expect.any(String),
        }),
      }),
    );
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain("token=secret");
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('"prompt":"hello"');
  });

  it("attaches a hidden provider at a full offscreen layout before sending", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const mainWindow = windowStub();
    const runtime = new ProviderRuntime({
      mainWindow,
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.send("hello");

    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(
      electronMock.view,
    );
    expect(electronMock.view.setBounds).toHaveBeenLastCalledWith({
      x: 1200,
      y: 84,
      width: 1024,
      height: 720,
    });
    expect(electronMock.view.setBounds).not.toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 1 }),
    );
    expect(electronMock.webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Input.insertText",
      { text: "hello" },
    );
    expect(electronMock.sentCommands).not.toContainEqual(
      expect.objectContaining({ type: "send-message" }),
    );
  });

  it("preserves the provider website modes when the request does not specify modes", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "deepseek",
      onEvent: vi.fn(),
    });

    await runtime.send("hello");

    expect(electronMock.sentCommands).not.toContainEqual(
      expect.objectContaining({ type: "configure-mode" }),
    );
    expect(electronMock.sentCommands).toContainEqual(
      expect.objectContaining({ type: "start-trusted-generation" }),
    );
  });

  it("applies an explicitly empty mode list", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "deepseek",
      onEvent: vi.fn(),
    });

    await runtime.send({
      conversationId: "conversation-1",
      text: "hello",
      modes: [],
    });

    expect(electronMock.sentCommands).toContainEqual(
      expect.objectContaining({
        type: "configure-mode",
        payload: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("keeps a hidden provider attached while generation is active", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const mainWindow = windowStub();
    const runtime = new ProviderRuntime({
      mainWindow,
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.send("hello");
    vi.useFakeTimers();
    runtime.setVisible(false);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it("delays detachment until generation completes", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const mainWindow = windowStub();
    const runtime = new ProviderRuntime({
      mainWindow,
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.send("hello");
    vi.useFakeTimers();
    electronMock.handlers.get("ipc-message")?.(
      {},
      "provider:event",
      { type: "message.completed", message: completedMessage() },
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(
      electronMock.view,
    );
  });

  it("cancels a pending detach when the provider drawer reopens", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const mainWindow = windowStub();
    const runtime = new ProviderRuntime({
      mainWindow,
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.send("hello");
    vi.useFakeTimers();
    electronMock.handlers.get("ipc-message")?.(
      {},
      "provider:event",
      { type: "message.completed", message: completedMessage() },
    );
    runtime.setVisible(true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
    expect(electronMock.view.setBounds).toHaveBeenLastCalledWith({
      x: 680,
      y: 84,
      width: 520,
      height: 716,
    });
  });

  it("temporarily attaches an unloaded provider to resync a missed response", async () => {
    vi.useFakeTimers();
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const mainWindow = windowStub();
    const runtime = new ProviderRuntime({
      mainWindow,
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    const resync = runtime.syncLatestResponse();
    await vi.advanceTimersByTimeAsync(150);
    await expect(resync).resolves.toBe(true);
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(
      electronMock.view,
    );
    expect(electronMock.view.setBounds).toHaveBeenLastCalledWith({
      x: 1200,
      y: 84,
      width: 1024,
      height: 720,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(
      electronMock.view,
    );
  });

  it("dispatches an Enter key sequence directly to the provider webContents", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "chatgpt",
      onEvent: vi.fn(),
    });

    await runtime.submitEnter();

    expect(electronMock.webContents.focus).toHaveBeenCalled();
    expect(electronMock.webContents.debugger.attach).toHaveBeenCalledWith("1.3");
    expect(electronMock.webContents.debugger.sendCommand).toHaveBeenNthCalledWith(
      1,
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "rawKeyDown", key: "Enter", code: "Enter" }),
    );
    expect(electronMock.webContents.debugger.sendCommand).toHaveBeenNthCalledWith(
      2,
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "char", text: "\r" }),
    );
    expect(electronMock.webContents.debugger.sendCommand).toHaveBeenNthCalledWith(
      3,
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyUp", key: "Enter", code: "Enter" }),
    );
  });

  it("clears the circuit breaker when recovery is requested", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const onEvent = vi.fn();
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "chatgpt",
      onEvent,
    });
    await runtime.initialize();

    electronMock.handlers.get("ipc-message")?.(
      {},
      "provider:event",
      { type: "adapter.degraded", reason: "synthetic degrade" },
    );

    await runtime.recover();

    expect(electronMock.sentCommands).toContainEqual(
      expect.objectContaining({ type: "detect-state" }),
    );
    await expect(runtime.detectState()).resolves.toMatchObject({
      degraded: false,
    });
  });

  it("best-effort disposes preload state before closing the provider view", async () => {
    const { ProviderRuntime } = await import("../src/main/provider-runtime");
    const runtime = new ProviderRuntime({
      mainWindow: windowStub(),
      provider: "chatgpt",
      onEvent: vi.fn(),
    });
    await runtime.initialize();

    runtime.destroy();

    expect(electronMock.sentCommands).toContainEqual(
      expect.objectContaining({ type: "dispose" }),
    );
    expect(electronMock.webContents.close).toHaveBeenCalled();
  });
});
