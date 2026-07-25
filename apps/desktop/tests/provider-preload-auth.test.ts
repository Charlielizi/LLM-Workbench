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

async function bootstrapProvider(provider: "chatgpt" | "claude"): Promise<void> {
  vi.resetModules();
  ipc.handlers.clear();
  ipc.sent = [];
  process.argv = [...originalArgv, `--aihub-provider=${provider}`];
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  await import("../src/provider-preload");
}

const originalArgv = process.argv;

describe("provider preload auth detection", () => {
  beforeEach(() => {
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
  });

  afterEach(async () => {
    if (ipc.handlers.get("provider:command")?.[0]) {
      await sendCommand("dispose");
    }
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("classifies ChatGPT auth pages before submit is attempted", async () => {
    await bootstrapProvider("chatgpt");
    history.replaceState({}, "", "/auth/login");
    document.body.innerHTML = `
      <main>
        <button type="button">Continue with Google</button>
        <button type="button">Continue with Apple</button>
      </main>
    `;

    const response = await sendCommand("send-message", { text: "blocked by chatgpt auth" });

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
  });

  it("classifies Claude logout pages before submit is attempted", async () => {
    await bootstrapProvider("claude");
    history.replaceState({}, "", "/logout");
    document.body.innerHTML = `
      <main>
        <button type="button">Continue with Google</button>
      </main>
    `;

    const response = await sendCommand("send-message", { text: "blocked by claude logout" });

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
  });
});
