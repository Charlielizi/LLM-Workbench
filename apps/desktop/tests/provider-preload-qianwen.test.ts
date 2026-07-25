// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (_event: unknown, command: unknown) => void | Promise<void>;

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler[]>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
}));

vi.mock("electron", () => ({
  ipcRenderer: {
    on: vi.fn((channel: string, handler: IpcHandler) => {
      const handlers = ipc.handlers.get(channel) ?? [];
      handlers.push(handler);
      ipc.handlers.set(channel, handlers);
    }),
    send: vi.fn((channel: string, payload: unknown) => {
      ipc.sent.push({ channel, payload });
    }),
  },
}));

async function waitForResponse(requestId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000) {
    const response = ipc.sent.find(
      (entry) => entry.channel === `provider:response:${requestId}`,
    );
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the Qianwen provider response.");
}

describe("provider preload Qianwen submission confirmation", () => {
  const originalArgv = process.argv;

  beforeEach(async () => {
    vi.resetModules();
    ipc.handlers.clear();
    ipc.sent = [];
    process.argv = [...originalArgv, "--aihub-provider=qianwen"];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 24,
      top: 0,
      right: 100,
      bottom: 24,
      left: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    document.body.innerHTML = `
      <main>
        <textarea placeholder="输入消息"></textarea>
        <button aria-label="发送消息" type="button"></button>
      </main>`;
    (window as unknown as { __aihubSubmitConfirmTimeoutMs?: number })
      .__aihubSubmitConfirmTimeoutMs = 300;
    await import("../src/provider-preload");
  });

  afterEach(async () => {
    const handler = ipc.handlers.get("provider:command")?.[0];
    if (handler) {
      await handler({}, {
        requestId: crypto.randomUUID(),
        type: "dispose",
      });
    }
    delete (window as unknown as { __aihubSubmitConfirmTimeoutMs?: number })
      .__aihubSubmitConfirmTimeoutMs;
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("does not accept a URL change without a submitted user turn", async () => {
    document.querySelector("button")?.addEventListener("click", () => {
      window.history.pushState({}, "", "/chat/new-session-without-turn");
    });
    const handler = ipc.handlers.get("provider:command")?.[0];
    if (!handler) throw new Error("Provider command handler was not registered.");
    const requestId = crypto.randomUUID();

    await handler({}, {
      requestId,
      type: "send-message",
      payload: { text: "AIHUB_QIANWEN_CONFIRMATION" },
    });
    const response = await waitForResponse(requestId);

    expect(response.payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("Submission detection failed"),
    });
    expect(
      ipc.sent
        .filter((entry) => entry.channel === "provider:event")
        .map((entry) => entry.payload),
    ).toContainEqual(expect.objectContaining({
      type: "generation.failed",
      code: "provider_submit_not_confirmed",
    }));
  });
});
