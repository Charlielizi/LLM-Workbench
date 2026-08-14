// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (_event: unknown, command: unknown) => void | Promise<void>;

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler[]>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  invoked: [] as string[],
  syncResult: {
    provider: "chatgpt",
    conversationId: "synced-conversation",
    created: true,
    syncedMessages: 2,
    partial: false,
    syncedAt: "2026-07-25T12:00:00.000Z",
  } as unknown,
  syncError: undefined as string | undefined,
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
    invoke: vi.fn(async (channel: string) => {
      ipc.invoked.push(channel);
      if (channel === "provider:sync-current-conversation") {
        if (ipc.syncError) throw new Error(ipc.syncError);
        return ipc.syncResult;
      }
      return undefined;
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
  throw new Error("Timed out waiting for provider preload integration state.");
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

function dispatchNetworkMonitorEvent(
  phase: "started" | "idle",
  activeCount: number,
): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: {
      type: "aihub-provider-network",
      phase,
      url: "https://chatgpt.com/backend-api/conversation",
      activeCount,
    },
  }));
}

describe("provider preload integration", () => {
  const originalArgv = process.argv;

  beforeEach(async () => {
    vi.resetModules();
    ipc.handlers.clear();
    ipc.sent = [];
    ipc.invoked = [];
    ipc.syncResult = {
      provider: "chatgpt",
      conversationId: "synced-conversation",
      created: true,
      syncedMessages: 2,
      partial: false,
      syncedAt: "2026-07-25T12:00:00.000Z",
    };
    ipc.syncError = undefined;
    process.argv = [...originalArgv, "--aihub-provider=chatgpt"];
    const attachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      return attachShadow.call(this, { ...init, mode: "open" });
    });
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
    delete (window as unknown as { __aihubSubmitConfirmTimeoutMs?: number })
      .__aihubSubmitConfirmTimeoutMs;
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("keeps diagnostics hidden while retaining the internal sync recovery path", async () => {
    window.dispatchEvent(new Event("DOMContentLoaded"));
    window.dispatchEvent(new Event("DOMContentLoaded"));
    const host = await waitFor(() =>
      document.getElementById("aihub-provider-controls") ?? undefined,
    );
    expect(document.querySelectorAll("#aihub-provider-controls")).toHaveLength(1);
    const syncButton = host.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-action='sync-current']",
    );
    const status = host.shadowRoot?.querySelector<HTMLElement>(".status");
    const debugButton = host.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-action='debug']",
    );
    const showClientButton = host.shadowRoot?.querySelector<HTMLButtonElement>(
      "button[data-action='show-client']",
    );
    expect(syncButton).toBeTruthy();
    expect(status).toBeTruthy();
    expect(syncButton!.hidden).toBe(true);
    expect(debugButton?.hidden).toBe(true);
    expect(showClientButton?.hidden).toBe(false);

    syncButton!.click();
    expect(syncButton!.dataset.state).toBe("syncing");
    expect(syncButton!.disabled).toBe(true);
    await waitFor(() =>
      syncButton!.dataset.state === "success" ? true : undefined,
    );
    expect(ipc.invoked).toContain("provider:sync-current-conversation");
    expect(status!.textContent).toBe("Synced 2 messages.");

    ipc.syncError = "Open a saved provider conversation before syncing.";
    syncButton!.click();
    await waitFor(() =>
      syncButton!.dataset.state === "error" ? true : undefined,
    );
    expect(syncButton!.disabled).toBe(false);
    expect(status!.textContent).toContain("Open a saved provider conversation");

    ipc.syncError = undefined;
    ipc.syncResult = {
      provider: "chatgpt",
      conversationId: "synced-conversation",
      created: false,
      syncedMessages: 5,
      partial: true,
      syncedAt: "2026-07-25T12:01:00.000Z",
    };
    syncButton!.click();
    await waitFor(() =>
      syncButton!.dataset.state === "partial" ? true : undefined,
    );
    expect(status!.textContent).toBe("Partially synced 5 messages.");
  });

  it("drives a mock provider page from send-message to completed assistant events", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      const stop = document.createElement("button");
      stop.setAttribute("data-testid", "stop-button");
      stop.textContent = "Stop";
      document.body.appendChild(stop);
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="assistant" data-turn-id="new">mock streamed answer</div>`,
        );
        stop.remove();
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "hello mock provider" });

    expect(response.payload).toMatchObject({ ok: true });
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value)
      .toBe("hello mock provider");
    await waitFor(() => providerEvents("message.started")[0]);
    expect(providerEvents("message.status")).toContainEqual(expect.objectContaining({
      type: "message.status",
      phase: "binding-assistant",
      detail: expect.stringContaining("captured conversation anchor"),
    }));
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await new Promise((resolve) => setTimeout(resolve, 2_650));
    await sendCommand("check-completion");
    let completed: { type: string } | undefined;
    try {
      completed = await waitFor(() => providerEvents("message.completed")[0]);
    } catch (error) {
      const snapshot = await sendCommand("get-debug-snapshot");
      throw new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        snapshot: snapshot.payload,
        statuses: providerEvents("message.status"),
      }));
    }
    expect(completed).toMatchObject({
      type: "message.completed",
      message: {
        role: "assistant",
        status: "completed",
        provider: "chatgpt",
      },
    });
    expect(JSON.stringify(completed)).toContain("mock streamed answer");
    const postCompletionSnapshot = await sendCommand("get-debug-snapshot");
    expect(postCompletionSnapshot.payload).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        assistantBinding: expect.stringContaining("bound-after-anchor"),
        completionDecision: "complete",
        fallbackUsed: false,
      }),
    });
  }, 10_000);

  it("waits for a transiently loading composer before classifying authentication", async () => {
    document.body.innerHTML = "<main>Loading provider…</main>";
    window.setTimeout(() => {
      document.querySelector("main")?.insertAdjacentHTML("beforeend", `
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>`);
      document.querySelector("button")?.addEventListener("click", () => {
        const composer = document.querySelector("textarea");
        if (composer) composer.value = "";
      });
    }, 50);

    const response = await sendCommand("send-message", { text: "wait for composer" });

    expect(response.payload).toMatchObject({ ok: true });
    expect(providerEvents("generation.failed")).not.toContainEqual(
      expect.objectContaining({ code: "auth_required" }),
    );
  });

  it("completes automatically even while polling keeps collecting provider snapshots", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="assistant" data-turn-id="new">auto completed answer</div>`,
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "complete without manual check" });

    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.snapshot")[0]);
    const completed = await waitFor(() => providerEvents("message.completed")[0], 6_000);

    expect(completed).toMatchObject({
      type: "message.completed",
      message: {
        role: "assistant",
        status: "completed",
        provider: "chatgpt",
      },
    });
    expect(JSON.stringify(completed)).toContain("auto completed answer");
  }, 10_000);

  it("emits a phased failure when authentication blocks sending before compose", async () => {
    document.body.innerHTML = `
      <main>
        <a href="/auth/login">Log in</a>
      </main>
    `;

    const response = await sendCommand("send-message", { text: "blocked by auth" });

    expect(response.payload).toMatchObject({
      ok: false,
      error: "Login or provider verification is required before sending.",
    });
    expect(providerEvents("provider.debug-snapshot")[0]).toMatchObject({
      type: "provider.debug-snapshot",
      snapshot: expect.objectContaining({
        completionDecision: "fail code=auth_required phase=checking-auth",
      }),
    });
    expect(providerEvents("generation.failed")[0]).toMatchObject({
      type: "generation.failed",
      code: "auth_required",
      phase: "checking-auth",
      detail: "Login or provider verification is required before sending.",
    });
  });

  it("recovers the latest assistant answer from an already updated mock page", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <div data-message-author-role="assistant" data-turn-id="new">missed answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;

    const response = await sendCommand("sync-latest-response");

    expect(response.payload).toMatchObject({ ok: true, value: true });
    const completed = providerEvents("message.completed")[0];
    expect(completed).toMatchObject({
      type: "message.completed",
      message: {
        role: "assistant",
        status: "completed",
        provider: "chatgpt",
      },
    });
    expect(JSON.stringify(completed)).toContain("missed answer");
  });

  it("captures the current conversation anchor for later assistant binding", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;

    const response = await sendCommand("capture-anchor");

    expect(response.payload).toMatchObject({
      ok: true,
      value: {
        sequence: 1,
        textSignature: "old answer",
        elementSignature: "div:old",
      },
    });
  });

  it("resynchronizes only the assistant reply that appears after a captured anchor", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;

    await sendCommand("capture-anchor");
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      `<div data-message-author-role="assistant" data-turn-id="new">new answer after anchor</div>`,
    );

    const response = await sendCommand("sync-latest-response");

    expect(response.payload).toMatchObject({ ok: true, value: true });
    expect(providerEvents("message.assistant-bound")[0]).toMatchObject({
      type: "message.assistant-bound",
      detail: expect.stringContaining("bound-after-anchor"),
    });
    const completed = providerEvents("message.completed")[0];
    expect(JSON.stringify(completed)).toContain("new answer after anchor");
    expect(JSON.stringify(completed)).not.toContain("old answer");
  });

  it("does not resynchronize an older assistant reply when no new reply appears after the captured anchor", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;

    await sendCommand("capture-anchor");

    const response = await sendCommand("sync-latest-response");

    expect(response.payload).toMatchObject({ ok: true, value: false });
    expect(providerEvents("message.completed")).toHaveLength(0);
    expect(providerEvents("message.assistant-bound")).toHaveLength(0);
  });

  it("resynchronizes an active provider message and completes it from the current page", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="assistant" data-turn-id="resync">answer visible only after manual resync</div>`,
        );
      }, 20);
    });

    const sendResponse = await sendCommand("send-message", { text: "needs resync" });
    expect(sendResponse.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.started")[0]);
    await waitFor(() => providerEvents("message.snapshot")[0]);

    const syncResponse = await sendCommand("sync-latest-response");

    expect(syncResponse.payload).toMatchObject({ ok: true, value: true });
    const completed = providerEvents("message.completed")[0];
    expect(completed).toMatchObject({
      type: "message.completed",
      message: {
        role: "assistant",
        status: "completed",
        provider: "chatgpt",
      },
    });
    expect(JSON.stringify(completed)).toContain("answer visible only after manual resync");
  }, 10_000);

  it("resynchronizes from the completed snapshot after virtualized DOM is removed", async () => {
    document.body.innerHTML = `
      <main>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="assistant" data-turn-id="cached">cached provider answer</div>`,
        );
      }, 20);
    });

    await sendCommand("send-message", { text: "cache this reply" });
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await sendCommand("sync-latest-response");
    expect(providerEvents("message.completed")).toHaveLength(1);

    document.querySelectorAll('[data-message-author-role="assistant"]')
      .forEach((element) => element.remove());
    const response = await sendCommand("sync-latest-response");

    expect(response.payload).toMatchObject({ ok: true, value: true });
    expect(providerEvents("message.completed")).toHaveLength(2);
    expect(providerEvents("message.assistant-bound").at(-1)).toMatchObject({
      detail: "cached-last-completed-assistant",
    });
    expect(JSON.stringify(providerEvents("message.completed").at(-1)))
      .toContain("cached provider answer");
  }, 10_000);

  it("includes completion signal details in debug snapshots", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      const stop = document.createElement("button");
      stop.setAttribute("data-testid", "stop-button");
      stop.textContent = "Stop";
      document.body.appendChild(stop);
    });

    const response = await sendCommand("send-message", { text: "still generating" });
    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.started")[0]);
    await sendCommand("check-completion");
    const snapshot = await sendCommand("get-debug-snapshot");

    expect(snapshot.payload).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        completionDecision: expect.stringContaining("stop=true"),
        completionSignals: expect.objectContaining({
          hasStopButton: true,
          networkIdle: true,
        }),
      }),
    });
    expect(JSON.stringify(snapshot.payload)).toContain("network=idle");
  });

  it("waits for provider network idle before completing a visible assistant answer", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      dispatchNetworkMonitorEvent("started", 1);
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="assistant" data-turn-id="network">answer while network active</div>`,
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "network gated" });
    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("provider.network-started")[0]);
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await new Promise((resolve) => setTimeout(resolve, 2_650));
    await sendCommand("check-completion");

    expect(providerEvents("message.completed")).toHaveLength(0);
    expect(providerEvents("message.status")).toContainEqual(expect.objectContaining({
      type: "message.status",
      phase: "detecting-completion",
      detail: "Assistant text is visible; waiting for provider network idle.",
    }));
    const activeSnapshot = await sendCommand("get-debug-snapshot");
    expect(JSON.stringify(activeSnapshot.payload)).toContain("network=active");
    expect(activeSnapshot.payload).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        activeMessageId: expect.any(String),
        assistantBinding: expect.stringContaining("bound-after-anchor"),
        lastNetworkUrl: "https://chatgpt.com/backend-api/conversation",
      }),
    });

    dispatchNetworkMonitorEvent("idle", 0);
    await waitFor(() => providerEvents("provider.network-idle")[0]);
    await sendCommand("check-completion");

    const completed = await waitFor(() => providerEvents("message.completed")[0]);
    expect(JSON.stringify(completed)).toContain("answer while network active");
  }, 10_000);

  it("fails before streaming when the provider page does not accept the submitted prompt", async () => {
    (window as unknown as { __aihubSubmitConfirmTimeoutMs?: number })
      .__aihubSubmitConfirmTimeoutMs = 250;
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;

    const response = await sendCommand("send-message", { text: "provider will ignore this" });

    expect(response.payload).toMatchObject({
      ok: false,
      error: expect.stringContaining("Submission detection failed"),
    });
    expect(providerEvents("message.started")).toHaveLength(0);
    const submitFailureSnapshot = providerEvents("provider.debug-snapshot").find((event) => {
      const snapshot = (event as { snapshot?: { completionDecision?: string } }).snapshot;
      return typeof snapshot?.completionDecision === "string" &&
        snapshot.completionDecision.includes("provider_submit_not_confirmed");
    });
    expect(submitFailureSnapshot).toMatchObject({
      type: "provider.debug-snapshot",
      snapshot: expect.objectContaining({
        completionDecision: expect.stringContaining("provider_submit_not_confirmed"),
      }),
    });
    expect(providerEvents("generation.failed")[0]).toMatchObject({
      type: "generation.failed",
      code: "provider_submit_not_confirmed",
      recoverable: true,
      phase: "confirming-submit",
    });
  });

  it("reclassifies auth interruptions during submit confirmation as checking-auth failures", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("[data-testid='send-button']")?.remove();
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<a href="/auth/login">Log in</a>`,
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "auth gate after submit" });

    expect(response.payload).toMatchObject({
      ok: false,
      error: "Login or provider verification is required before sending.",
    });
    expect(providerEvents("message.started")).toHaveLength(0);
    const authFailureSnapshot = providerEvents("provider.debug-snapshot").find((event) => {
      const snapshot = (event as { snapshot?: { completionDecision?: string } }).snapshot;
      return snapshot?.completionDecision === "fail code=auth_required phase=checking-auth";
    });
    expect(authFailureSnapshot).toMatchObject({
      type: "provider.debug-snapshot",
      snapshot: expect.objectContaining({
        completionDecision: "fail code=auth_required phase=checking-auth",
      }),
    });
    expect(providerEvents("generation.failed")[0]).toMatchObject({
      type: "generation.failed",
      code: "auth_required",
      phase: "checking-auth",
      detail: "Login or provider verification is required before sending.",
    });
  }, 10_000);

  it("confirms submit when the provider renders a new user turn before any assistant reply", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          `<div data-message-author-role="user" data-turn-id="u2">accepted user prompt</div>`,
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "accepted user prompt" });

    expect(response.payload).toMatchObject({ ok: true });
    expect(providerEvents("generation.failed")).toHaveLength(0);
    await waitFor(() => providerEvents("message.started")[0]);
    expect(providerEvents("message.snapshot")).toHaveLength(0);
  });

  it("submits an already prepared prompt when manual recovery resumes with an empty text payload", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea">prepared manual prompt</textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          [
            `<div data-message-author-role="user" data-turn-id="u2">prepared manual prompt</div>`,
            `<div data-message-author-role="assistant" data-turn-id="a2">manual resumed answer</div>`,
          ].join(""),
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "" });

    expect(response.payload).toMatchObject({ ok: true });
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value)
      .toBe("prepared manual prompt");
    await waitFor(() => providerEvents("message.started")[0]);
    await waitFor(() => providerEvents("message.snapshot")[0]);
    await new Promise((resolve) => setTimeout(resolve, 2_650));
    await sendCommand("check-completion");

    const completed = await waitFor(() => providerEvents("message.completed")[0]);
    expect(JSON.stringify(completed)).toContain("manual resumed answer");
    expect(providerEvents("generation.failed")).toHaveLength(0);
  }, 10_000);

  it("fails recoverably when a verification or error modal blocks generation", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          [
            `<div data-message-author-role="user" data-turn-id="u2">blocked prompt</div>`,
            `<div role="alert" class="provider-error-modal">Verification required. Try again.</div>`,
          ].join(""),
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "blocked prompt" });
    expect(response.payload).toMatchObject({ ok: true });
    await waitFor(() => providerEvents("message.started")[0]);
    await sendCommand("check-completion");

    const blockerSnapshot = providerEvents("provider.debug-snapshot").find((event) => {
      const snapshot = (event as {
        snapshot?: { completionSignals?: { hasRecoverableBlocker?: boolean } };
      }).snapshot;
      return snapshot?.completionSignals?.hasRecoverableBlocker === true;
    });
    expect(blockerSnapshot).toMatchObject({
      type: "provider.debug-snapshot",
      snapshot: expect.objectContaining({
        completionSignals: expect.objectContaining({
          hasRecoverableBlocker: true,
          recoverableBlockerReason: "Verification required. Try again.",
        }),
      }),
    });
    expect(providerEvents("generation.failed")[0]).toMatchObject({
      type: "generation.failed",
      code: "provider_recoverable_blocked",
      phase: "recoverable-blocked",
      recoverable: true,
      detail: "Verification required. Try again.",
    });
  });

  it("injects and removes clean mode css in document and shadow roots", async () => {
    document.body.innerHTML = `<main><div id="shadow-host"></div></main>`;
    const host = document.getElementById("shadow-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<aside>shadow sidebar</aside><section>shadow content</section>`;

    await sendCommand("set-clean-mode", { cleanMode: true });

    expect(document.querySelectorAll("style#aihub-clean-mode")).toHaveLength(1);
    expect(shadow.querySelectorAll("style#aihub-clean-mode")).toHaveLength(1);
    expect(shadow.querySelector("style#aihub-clean-mode")?.textContent)
      .toContain("aside");

    await sendCommand("set-clean-mode", { cleanMode: false });

    expect(document.querySelectorAll("style#aihub-clean-mode")).toHaveLength(0);
    expect(shadow.querySelectorAll("style#aihub-clean-mode")).toHaveLength(0);
  });

  it("injects clean mode css into shadow roots created after clean mode is enabled", async () => {
    document.body.innerHTML = `<main><div id="late-shadow-host"></div></main>`;

    await sendCommand("set-clean-mode", { cleanMode: true });

    const host = document.getElementById("late-shadow-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<aside>late sidebar</aside><section>late content</section>`;
    await Promise.resolve();

    expect(document.querySelectorAll("style#aihub-clean-mode")).toHaveLength(1);
    expect(shadow.querySelectorAll("style#aihub-clean-mode")).toHaveLength(1);
    expect(shadow.querySelector("style#aihub-clean-mode")?.textContent)
      .toContain("aside");

    await sendCommand("set-clean-mode", { cleanMode: false });

    expect(shadow.querySelectorAll("style#aihub-clean-mode")).toHaveLength(0);
  });

  it("does not bind user turns or recommendation cards as the assistant reply", async () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button" type="button">Send</button>
        </form>
      </main>
    `;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        document.querySelector("main")?.insertAdjacentHTML(
          "beforeend",
          [
            `<div data-message-author-role="user" data-turn-id="u2">user echo</div>`,
            `<div data-message-author-role="assistant" data-turn-id="a2">real assistant answer</div>`,
            `<div class="recommend-card" data-message-author-role="assistant">recommended prompt</div>`,
          ].join(""),
        );
      }, 20);
    });

    const response = await sendCommand("send-message", { text: "ignore false positives" });
    expect(response.payload).toMatchObject({ ok: true });
    try {
      await waitFor(() => providerEvents("message.snapshot")[0], 4_000);
      await new Promise((resolve) => setTimeout(resolve, 2_650));
      await sendCommand("check-completion");
    } catch (error) {
      const snapshot = await sendCommand("get-debug-snapshot");
      throw new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        snapshot: snapshot.payload,
        statuses: providerEvents("message.status"),
      }));
    }
    let completed: { type: string } | undefined;
    try {
      completed = await waitFor(() => providerEvents("message.completed")[0], 4_000);
    } catch (error) {
      const snapshot = await sendCommand("get-debug-snapshot");
      throw new Error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        snapshot: snapshot.payload,
        events: ipc.sent.filter((entry) => entry.channel === "provider:event").map((entry) => entry.payload),
      }));
    }

    expect(JSON.stringify(completed)).toContain("real assistant answer");
    expect(JSON.stringify(completed)).not.toContain("recommended prompt");
    expect(JSON.stringify(completed)).not.toContain("user echo");
  }, 10_000);
});
