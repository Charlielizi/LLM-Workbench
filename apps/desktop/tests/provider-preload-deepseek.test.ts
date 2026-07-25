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
  while (Date.now() - startedAt < 4_000) {
    const response = ipc.sent.find(
      (entry) => entry.channel === `provider:response:${requestId}`,
    );
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the DeepSeek provider response.");
}

describe("provider preload DeepSeek new-session submission", () => {
  const originalArgv = process.argv;

  beforeEach(async () => {
    vi.resetModules();
    ipc.handlers.clear();
    ipc.sent = [];
    process.argv = [...originalArgv, "--aihub-provider=deepseek"];
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
    document.body.innerHTML = `
      <main>
        <textarea placeholder="Message DeepSeek"></textarea>
        <div role="button" class="ds-button ds-button--primary ds-button--filled"></div>
      </main>
    `;
    (window as unknown as { __aihubSubmitConfirmTimeoutMs?: number })
      .__aihubSubmitConfirmTimeoutMs = 1_000;
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
    window.history.replaceState({}, "", "/");
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("re-enters and submits the prompt after the first click only creates a session", async () => {
    const prompt = "AIHUB_DEEPSEEK_NEW_SESSION";
    let clicks = 0;
    const attachHandler = (submit: HTMLElement) => {
      submit.addEventListener("click", () => {
        clicks += 1;
        if (clicks === 1) {
          window.history.pushState({}, "", "/a/chat/s/new-session");
          document.querySelector("main")!.innerHTML = `
            <textarea placeholder="Message DeepSeek"></textarea>
            <div role="button" class="ds-button ds-button--primary ds-button--filled"></div>
          `;
          attachHandler(document.querySelector<HTMLElement>("[role='button']")!);
          return;
        }
        document.querySelector("main")!.insertAdjacentHTML(
          "beforeend",
          `<div class="ds-message ds-message--assistant">
            <div class="ds-markdown">DeepSeek accepted ${prompt}</div>
          </div>`,
        );
      });
    };
    attachHandler(document.querySelector<HTMLElement>("[role='button']")!);

    const handler = ipc.handlers.get("provider:command")?.[0];
    if (!handler) throw new Error("Provider command handler was not registered.");
    const requestId = crypto.randomUUID();
    await handler({}, {
      requestId,
      type: "send-message",
      payload: { text: prompt },
    });
    const response = await waitForResponse(requestId);

    expect(response.payload).toMatchObject({ ok: true });
    expect(clicks).toBe(2);
    expect(
      ipc.sent
        .filter((entry) => entry.channel === "provider:event")
        .map((entry) => entry.payload),
    ).toContainEqual(expect.objectContaining({
      type: "message.status",
      detail: "deepseek-session-created-resubmitted",
    }));
  });

  it("does not submit twice when the first click already started completion", async () => {
    const prompt = "AIHUB_DEEPSEEK_COMPLETION_STARTED";
    let clicks = 0;
    document.querySelector<HTMLElement>("[role='button']")!.addEventListener(
      "click",
      () => {
        clicks += 1;
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "aihub-provider-network",
            phase: "started",
            url: "/api/v0/chat/completion",
            activeCount: 1,
          },
        }));
        window.history.pushState({}, "", "/a/chat/s/completion-session");
      },
    );

    const handler = ipc.handlers.get("provider:command")?.[0];
    if (!handler) throw new Error("Provider command handler was not registered.");
    const requestId = crypto.randomUUID();
    await handler({}, {
      requestId,
      type: "send-message",
      payload: { text: prompt },
    });
    const response = await waitForResponse(requestId);

    expect(response.payload).toMatchObject({ ok: true });
    expect(clicks).toBe(1);
  });
});
