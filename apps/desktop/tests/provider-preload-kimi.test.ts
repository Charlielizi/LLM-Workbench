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

function responseFor(requestId: string) {
  return ipc.sent.find((entry) => entry.channel === `provider:response:${requestId}`);
}

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs = 7_000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for provider preload state.");
}

async function sendCommand(type: string, payload?: Record<string, unknown>) {
  const handler = ipc.handlers.get("provider:command")?.[0];
  if (!handler) throw new Error("Provider command handler was not registered.");
  const requestId = crypto.randomUUID();
  await handler({}, { requestId, type, payload });
  return waitFor(() => responseFor(requestId));
}

function providerEvents(type: string) {
  return ipc.sent
    .filter((entry) => entry.channel === "provider:event")
    .map((entry) => entry.payload)
    .filter((payload): payload is { type: string } =>
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      (payload as { type: string }).type === type,
    );
}

describe("provider preload kimi submitWithEnter", () => {
  const originalArgv = process.argv;

  beforeEach(async () => {
    vi.resetModules();
    ipc.handlers.clear();
    ipc.sent = [];
    process.argv = [...originalArgv, "--aihub-provider=kimi"];
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
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    await import("../src/provider-preload");
  });

  afterEach(async () => {
    if (ipc.handlers.get("provider:command")?.[0]) {
      await sendCommand("dispose");
    }
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("submits through Enter when Kimi has no visible send button", async () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="Ask Kimi"></textarea>
      </main>
    `;
    document.querySelector("textarea")?.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Enter") return;
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-role="assistant"><div class="segment-content">kimi enter answer</div></div>`,
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "kimi enter submit" });

    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.started")[0]);
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await new Promise((resolve) => setTimeout(resolve, 2_650));
    await sendCommand("check-completion");
    expect(providerEvents("message.completed")).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 7_600));
    await sendCommand("check-completion");
    const completed = await waitFor(() => providerEvents("message.completed")[0], 4_000);

    expect(completed).toMatchObject({
      type: "message.completed",
      message: {
        role: "assistant",
        status: "completed",
        provider: "kimi",
      },
    });
    expect(JSON.stringify(completed)).toContain("kimi enter answer");
  }, 25_000);

  it("does not complete a Kimi answer during a short mid-stream pause", async () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="Ask Kimi"></textarea>
      </main>
    `;
    document.querySelector("textarea")?.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-role="assistant"><div class="segment-content">first part,</div></div>`,
        );
      }, 20);
      setTimeout(() => {
        const content = document.querySelector<HTMLElement>(".segment-content");
        if (content) content.textContent = "first part, followed by the complete answer";
      }, 3_500);
    });

    const response = await sendCommand("send-message", { text: "long kimi answer" });

    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await sendCommand("check-completion");
    expect(providerEvents("message.completed")).toHaveLength(0);

    await waitFor(() => {
      const events = providerEvents("message.snapshot");
      return events.some((event) => JSON.stringify(event).includes("complete answer"))
        ? true
        : undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 10_100));
    await sendCommand("check-completion");
    const completed = await waitFor(() => providerEvents("message.completed")[0], 4_000);
    expect(JSON.stringify(completed)).toContain("complete answer");
  }, 25_000);

  it("fails in checking-auth before submit when Kimi shows a login-gated composer", async () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-input-editor" contenteditable="true" role="textbox"></div>
        <button class="kimi-button info phone-login-action" type="button">Send verification code</button>
        <button class="next-sidebar-history-list__login" type="button">Login</button>
      </main>
    `;

    const response = await sendCommand("send-message", { text: "blocked by kimi login gate" });

    expect(response.payload).toMatchObject({
      ok: false,
      error: "Login or provider verification is required before sending.",
    });
    expect(providerEvents("message.status")[0]).toMatchObject({
      type: "message.status",
      phase: "checking-auth",
    });
    expect(providerEvents("generation.failed")[0]).toMatchObject({
      type: "generation.failed",
      code: "auth_required",
      phase: "checking-auth",
      detail: "Login or provider verification is required before sending.",
    });
    expect(providerEvents("message.status").some((event) =>
      event.type === "message.status" &&
      "phase" in event &&
      event.phase === "submitting"
    ))
      .toBe(false);
  });

});
