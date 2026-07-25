import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AdapterEventRecord,
  AppSnapshot,
  NormalizedConversation,
  ProviderDebugSnapshot,
  ProviderId,
} from "@aihub/core";
import {
  collectProviderSmokeDiagnostics,
  providerSmokePaths,
  readProviderSmokeRequest,
  runProviderSmokeTest,
  writeProviderSmokeResult,
} from "../src/main/provider-smoke";

describe("provider-smoke helpers", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("derives stable request and result paths", () => {
    const paths = providerSmokePaths(
      "C:\\Users\\li\\AppData\\Roaming\\AIHub",
      "chatgpt",
    );
    expect(paths.requestPath).toContain("provider-smoke-request.json");
    expect(paths.resultPath).toContain("provider-smoke-chatgpt.json");
    expect(providerSmokePaths(
      "C:\\Users\\li\\AppData\\Roaming\\AIHub",
      "chatgpt",
      "manual-recovery",
    ).resultPath).toContain("provider-smoke-chatgpt-manual-recovery.json");
    expect(providerSmokePaths(
      "C:\\Users\\li\\AppData\\Roaming\\AIHub",
      "doubao",
      "background-send",
    ).resultPath).toContain("provider-smoke-doubao-background-send.json");
  });

  it("parses valid smoke requests and ignores malformed files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const requestPath = path.join(tempDir, "provider-smoke-request.json");
    await writeFile(requestPath, "\uFEFF{\"provider\":\"doubao\"}", "utf8");

    await expect(readProviderSmokeRequest(requestPath)).resolves.toEqual({
      provider: "doubao",
      scenario: undefined,
      timeoutMs: undefined,
      targetRuntimeInstanceId: undefined,
    });

    await writeFile(
      requestPath,
      "{\"provider\":\"chatgpt\",\"scenario\":\"manual-recovery\",\"timeoutMs\":15000,\"targetRuntimeInstanceId\":\"runtime-123\"}",
      "utf8",
    );
    await expect(readProviderSmokeRequest(requestPath)).resolves.toEqual({
      provider: "chatgpt",
      scenario: "manual-recovery",
      timeoutMs: 15000,
      targetRuntimeInstanceId: "runtime-123",
    });

    await writeFile(requestPath, "{\"provider\":\"unknown\"}", "utf8");
    await expect(readProviderSmokeRequest(requestPath)).resolves.toBeUndefined();
  });

  it("collects diagnostics and preserves debug snapshot failures separately", async () => {
    const snapshot = createSnapshot("chatgpt");
    const adapterEvents: AdapterEventRecord[] = [{
      id: 1,
      provider: "chatgpt",
      type: "provider.network-idle",
      createdAt: new Date().toISOString(),
    }];
    const diagnostics = await collectProviderSmokeDiagnostics({
      snapshot: () => snapshot,
      getProviderDebugSnapshot: async () => {
        throw new Error("provider bridge unavailable");
      },
      listProviderAdapterEvents: () => adapterEvents,
    }, "chatgpt", { sinceCreatedAt: "2026-07-09T00:00:00.000Z" });

    expect(diagnostics.providerSummary?.id).toBe("chatgpt");
    expect(diagnostics.debugSnapshot).toBeUndefined();
    expect(diagnostics.debugSnapshotError).toBe("provider bridge unavailable");
    expect(diagnostics.adapterEventSinceCreatedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(diagnostics.adapterEvents).toEqual(adapterEvents);
  });

  it("passes the smoke startedAt through to adapter event collection", async () => {
    const requests: Array<{ provider: ProviderId; limit?: number; sinceCreatedAt?: string }> = [];
    const snapshot = createSnapshot("chatgpt");
    const adapterEvents: AdapterEventRecord[] = [];

    await collectProviderSmokeDiagnostics({
      snapshot: () => snapshot,
      getProviderDebugSnapshot: async () => createDebugSnapshot("chatgpt"),
      listProviderAdapterEvents: (provider, limit, sinceCreatedAt) => {
        requests.push({ provider, limit, sinceCreatedAt });
        return adapterEvents;
      },
    }, "chatgpt", { sinceCreatedAt: "2026-07-09T13:00:00.000Z" });

    expect(requests).toEqual([{
      provider: "chatgpt",
      limit: 500,
      sinceCreatedAt: "2026-07-09T13:00:00.000Z",
    }]);
  });

  it("writes schema-valid smoke results to disk", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const outputPath = path.join(tempDir, "provider-smoke-chatgpt.json");
    const now = new Date().toISOString();

    await writeProviderSmokeResult(
      outputPath,
      {
        provider: "chatgpt",
        token: "AIHUB_CHATGPT_123",
        sendError: null,
        runtime: {
          instanceId: "runtime-1",
          pid: 12345,
          startedAt: now,
        },
      },
      {
        providerSummary: createSnapshot("chatgpt").providers[0],
        debugSnapshot: createDebugSnapshot("chatgpt"),
        adapterEvents: [{
          id: 1,
          provider: "chatgpt",
          type: "provider.debug-snapshot",
          createdAt: now,
        }],
      },
    );

    const written = JSON.parse(await readFile(outputPath, "utf8")) as {
      provider: ProviderId;
      runtime?: { instanceId: string; pid: number; startedAt: string };
      diagnostics: { debugSnapshot: ProviderDebugSnapshot; adapterEventSinceCreatedAt?: string };
      stage?: string;
      verification?: { kind: string; notes: string[] };
    };
    expect(written.provider).toBe("chatgpt");
    expect(written.runtime).toEqual({
      instanceId: "runtime-1",
      pid: 12345,
      startedAt: now,
    });
    expect(written.diagnostics.debugSnapshot.provider).toBe("chatgpt");
    expect(written.diagnostics.adapterEventSinceCreatedAt).toBeUndefined();
    expect(written.stage).toBeUndefined();
    expect(written.verification).toMatchObject({
      kind: "unclassified-failure",
    });
  });

  it("runs the smoke flow and writes a completed assistant result", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(tempDir, "chatgpt");
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(requestPath, "{\"provider\":\"chatgpt\"}", "utf8");

    const conversationId = "conversation-1";
    const assistant = createAssistantMessage("chatgpt", conversationId, "AIHUB_CHATGPT_1000");
    const snapshots: AppSnapshot[] = [
      createSnapshot("chatgpt"),
      {
        ...createSnapshot("chatgpt"),
        conversations: [{
          id: conversationId,
          title: "Smoke",
          provider: "chatgpt",
          hidden: false,
          pinned: false,
          documentIds: [],
          tagIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            createUserMessage("chatgpt", conversationId, "AIHUB_CHATGPT_1000"),
            assistant,
          ],
        }],
      },
    ];
    let snapshotIndex = 0;

    await runProviderSmokeTest(
      {
        snapshot: () => {
          const current = snapshots[Math.min(snapshotIndex, snapshots.length - 1)]!;
          if (snapshotIndex < snapshots.length - 1) snapshotIndex += 1;
          return current;
        },
        createConversation: async () => ({
          id: conversationId,
          title: "Smoke",
          provider: "chatgpt",
          hidden: false,
          pinned: false,
          documentIds: [],
          tagIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        }),
        sendMessage: async () => undefined,
        submitProviderEnter: async () => undefined,
        deleteMessage: () => undefined,
        syncLatestProviderResponse: async () => false,
        setWebsiteVisible: async () => undefined,
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("chatgpt"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      {
        now: (() => {
          let value = 1000;
          return () => value;
        })(),
        runtime: {
          instanceId: "runtime-flow",
          pid: 4321,
          startedAt: new Date(1000).toISOString(),
        },
        sleep: async () => undefined,
      },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      runtime?: { instanceId: string; pid: number; startedAt: string };
      assistantMessage?: { status: string };
      timeout?: boolean;
      verification?: { kind: string; synchronized: boolean };
    };
    expect(written.runtime).toEqual({
      instanceId: "runtime-flow",
      pid: 4321,
      startedAt: new Date(1000).toISOString(),
    });
    expect(written.assistantMessage?.status).toBe("completed");
    expect(written.timeout).toBeUndefined();
    expect(written.verification).toMatchObject({
      kind: "normal-send-completed",
      synchronized: true,
    });
  });

  it("rejects a completed assistant result that omits the unique token", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const outputPath = path.join(tempDir, "provider-smoke-kimi.json");
    const conversationId = "conversation-content-mismatch";
    const token = "AIHUB_KIMI_1000";

    const written = await writeProviderSmokeResult(
      outputPath,
      {
        provider: "kimi",
        scenario: "normal-send",
        token,
        userMessage: createUserMessage("kimi", conversationId, token),
        assistantMessage: createAssistantMessage("kimi", conversationId, "AI"),
      },
      {
        providerSummary: createSnapshot("kimi").providers[0],
        debugSnapshot: createDebugSnapshot("kimi"),
        adapterEvents: [],
      },
    );

    expect(written.verification).toMatchObject({
      kind: "content-mismatch",
      diagnosed: true,
      synchronized: false,
    });
    expect(written.verification?.notes).toContain(
      `expectedTokenMissing=${token}`,
    );
  });

  it("runs a background send with the provider drawer kept closed", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(
      tempDir,
      "doubao",
      "background-send",
    );
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(
      requestPath,
      "{\"provider\":\"doubao\",\"scenario\":\"background-send\"}",
      "utf8",
    );

    const conversationId = "background-conversation";
    const token = "AIHUB_DOUBAO_1000";
    const conversation: NormalizedConversation = {
      id: conversationId,
      title: "Background smoke",
      provider: "doubao",
      hidden: false,
      pinned: false,
      documentIds: [],
      tagIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    let currentSnapshot = createSnapshot("doubao");
    const visibility: boolean[] = [];
    const sleeps: number[] = [];
    const calls: string[] = [];

    await runProviderSmokeTest(
      {
        snapshot: () => currentSnapshot,
        createConversation: async () => conversation,
        sendMessage: async () => {
          currentSnapshot = {
            ...createSnapshot("doubao"),
            providers: [{
              ...createSnapshot("doubao").providers[0]!,
              websiteVisible: false,
            }],
            conversations: [{
              ...conversation,
              messages: [
                createUserMessage("doubao", conversationId, "background token"),
                createAssistantMessage("doubao", conversationId, `${token} background answer`),
              ],
            }],
          };
        },
        submitProviderEnter: async () => undefined,
        deleteMessage: (_conversationId, messageId) => {
          calls.push(`delete:${messageId}`);
          currentSnapshot = {
            ...currentSnapshot,
            conversations: [{
              ...conversation,
              messages: [createUserMessage(
                "doubao",
                conversationId,
                "background token",
              )],
            }],
          };
        },
        syncLatestProviderResponse: async () => {
          calls.push("sync");
          currentSnapshot = {
            ...currentSnapshot,
            conversations: [{
              ...conversation,
              messages: [
                createUserMessage("doubao", conversationId, "background token"),
                createAssistantMessage("doubao", conversationId, `${token} recovered answer`),
              ],
            }],
          };
          return true;
        },
        setWebsiteVisible: async (_provider, visible) => {
          visibility.push(visible);
          currentSnapshot = {
            ...currentSnapshot,
            providers: currentSnapshot.providers.map((item) => ({
              ...item,
              websiteVisible: visible,
            })),
          };
        },
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("doubao"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      {
        now: () => 1000,
        backgroundSettleMs: 31_000,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      scenario?: string;
      resyncAttempted?: boolean;
      resyncSucceeded?: boolean;
      diagnostics?: { providerSummary?: { websiteVisible?: boolean } };
      verification?: { kind: string; synchronized: boolean };
    };
    expect(visibility).toEqual([false]);
    expect(sleeps[0]).toBe(31_000);
    expect(calls).toEqual([expect.stringMatching(/^delete:/), "sync"]);
    expect(written).toMatchObject({
      scenario: "background-send",
      resyncAttempted: true,
      resyncSucceeded: true,
      diagnostics: { providerSummary: { websiteVisible: false } },
      verification: {
        kind: "background-send-completed",
        synchronized: true,
      },
    });
  });

  it("runs manual recovery through the production backend boundary and restores settings", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(
      tempDir,
      "doubao",
      "manual-recovery",
    );
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(
      requestPath,
      "{\"provider\":\"doubao\",\"scenario\":\"manual-recovery\"}",
      "utf8",
    );

    const conversationId = "manual-conversation";
    const token = "AIHUB_DOUBAO_1000";
    const originalSettings = {
      theme: "dark" as const,
      providerBackends: { doubao: "web" as const },
    };
    const appliedSettings: unknown[] = [];
    const calls: string[] = [];
    let currentSnapshot = createSnapshot("doubao");
    const conversation: NormalizedConversation = {
      id: conversationId,
      title: "Manual smoke",
      provider: "doubao" as const,
      hidden: false,
      pinned: false,
      documentIds: [],
      tagIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    await runProviderSmokeTest(
      {
        snapshot: () => currentSnapshot,
        createConversation: async () => conversation,
        sendMessage: async () => {
          calls.push("compose");
          currentSnapshot = {
            ...createSnapshot("doubao"),
            conversations: [{
              ...conversation,
              messages: [{
                ...createUserMessage("doubao", conversationId, "manual token"),
                statusPhase: "recoverable-blocked",
              }],
            }],
          };
        },
        submitProviderEnter: async () => {
          calls.push("submit");
          currentSnapshot = {
            ...createSnapshot("doubao"),
            conversations: [{
              ...conversation,
              messages: [
                createUserMessage("doubao", conversationId, "manual token"),
                createAssistantMessage("doubao", conversationId, `${token} manual answer`),
              ],
            }],
          };
        },
        deleteMessage: () => undefined,
        syncLatestProviderResponse: async () => false,
        setWebsiteVisible: async () => undefined,
        getSettings: () => originalSettings,
        setSettings: (settings) => {
          appliedSettings.push(settings);
        },
        getProviderDebugSnapshot: async () => createDebugSnapshot("doubao"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      { now: () => 1000, sleep: async () => undefined },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      scenario?: string;
      verification?: { kind: string; synchronized: boolean };
    };
    expect(calls).toEqual(["compose", "submit"]);
    expect(appliedSettings[0]).toMatchObject({
      providerBackends: { doubao: "manual" },
    });
    expect(appliedSettings.at(-1)).toEqual(originalSettings);
    expect(written.scenario).toBe("manual-recovery");
    expect(written.verification).toEqual(expect.objectContaining({
      kind: "manual-recovery-completed",
      synchronized: true,
    }));
  });

  it("deletes a local assistant and recovers it through latest-response resync", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(
      tempDir,
      "doubao",
      "resync-latest",
    );
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(
      requestPath,
      "{\"provider\":\"doubao\",\"scenario\":\"resync-latest\"}",
      "utf8",
    );

    const conversationId = "resync-conversation";
    const token = "AIHUB_DOUBAO_1000";
    const conversation: NormalizedConversation = {
      id: conversationId,
      title: "Resync smoke",
      provider: "doubao",
      hidden: false,
      pinned: false,
      documentIds: [],
      tagIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    const user = createUserMessage("doubao", conversationId, "resync token");
    const originalAssistant = createAssistantMessage(
      "doubao",
      conversationId,
      `${token} original synchronized answer`,
    );
    const recoveredAssistant = {
      ...createAssistantMessage("doubao", conversationId, `${token} recovered answer`),
      id: "recovered-assistant",
    };
    let currentSnapshot = createSnapshot("doubao");
    const calls: string[] = [];

    await runProviderSmokeTest(
      {
        snapshot: () => currentSnapshot,
        createConversation: async () => conversation,
        sendMessage: async () => {
          currentSnapshot = {
            ...createSnapshot("doubao"),
            conversations: [{
              ...conversation,
              messages: [user, originalAssistant],
            }],
          };
        },
        submitProviderEnter: async () => undefined,
        deleteMessage: (_conversationId, messageId) => {
          calls.push(`delete:${messageId}`);
          currentSnapshot = {
            ...createSnapshot("doubao"),
            conversations: [{ ...conversation, messages: [user] }],
          };
        },
        syncLatestProviderResponse: async () => {
          calls.push("sync");
          currentSnapshot = {
            ...createSnapshot("doubao"),
            conversations: [{
              ...conversation,
              messages: [user, recoveredAssistant],
            }],
          };
          return true;
        },
        setWebsiteVisible: async () => undefined,
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("doubao"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      { now: () => 1000, sleep: async () => undefined },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      resyncAttempted?: boolean;
      resyncSucceeded?: boolean;
      assistantMessage?: { id: string; content: Array<{ text?: string }> };
      verification?: { kind: string; synchronized: boolean };
    };
    expect(calls).toEqual([`delete:${originalAssistant.id}`, "sync"]);
    expect(written).toMatchObject({
      resyncAttempted: true,
      resyncSucceeded: true,
      assistantMessage: { id: "recovered-assistant" },
      verification: {
        kind: "resync-latest-completed",
        synchronized: true,
      },
    });
  });

  it("writes a timeout result when no assistant reply arrives", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(tempDir, "chatgpt");
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(requestPath, "{\"provider\":\"chatgpt\"}", "utf8");

    let currentTime = 0;
    await runProviderSmokeTest(
      {
        snapshot: () => ({
          ...createSnapshot("chatgpt"),
          conversations: [{
            id: "conversation-timeout",
            title: "Smoke",
            provider: "chatgpt",
            hidden: false,
            pinned: false,
            documentIds: [],
            tagIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [createUserMessage("chatgpt", "conversation-timeout", "waiting")],
          }],
        }),
        createConversation: async () => ({
          id: "conversation-timeout",
          title: "Smoke",
          provider: "chatgpt",
          hidden: false,
          pinned: false,
          documentIds: [],
          tagIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        }),
        sendMessage: async () => undefined,
        submitProviderEnter: async () => undefined,
        deleteMessage: () => undefined,
        syncLatestProviderResponse: async () => false,
        setWebsiteVisible: async () => undefined,
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("chatgpt"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      {
        timeoutMs: 10,
        pollIntervalMs: 5,
        now: () => currentTime,
        sleep: async (ms) => {
          currentTime += ms;
        },
      },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      timeout?: boolean;
      conversation?: { id: string };
      verification?: { kind: string };
    };
    expect(written.timeout).toBe(true);
    expect(written.conversation?.id).toBe("conversation-timeout");
    expect(written.verification?.kind).toBe("timeout");
  });

  it("stops polling when the provider assistant reaches a failed terminal state", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath, resultPath } = providerSmokePaths(tempDir, "deepseek");
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(requestPath, "{\"provider\":\"deepseek\"}", "utf8");
    const conversationId = "conversation-provider-failed";
    const failedAssistant = {
      ...createAssistantMessage("deepseek", conversationId, ""),
      status: "failed" as const,
      statusPhase: "waiting-first-token" as const,
    };
    let sleepCalls = 0;

    await runProviderSmokeTest(
      {
        snapshot: () => ({
          ...createSnapshot("deepseek"),
          conversations: [{
            id: conversationId,
            title: "Smoke",
            provider: "deepseek",
            hidden: false,
            pinned: false,
            documentIds: [],
            tagIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [
              createUserMessage("deepseek", conversationId, "waiting"),
              failedAssistant,
            ],
          }],
        }),
        createConversation: async () => ({
          id: conversationId,
          title: "Smoke",
          provider: "deepseek",
          hidden: false,
          pinned: false,
          documentIds: [],
          tagIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        }),
        sendMessage: async () => undefined,
        submitProviderEnter: async () => undefined,
        deleteMessage: () => undefined,
        syncLatestProviderResponse: async () => false,
        setWebsiteVisible: async () => undefined,
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("deepseek"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      {
        timeoutMs: 60_000,
        sleep: async () => {
          sleepCalls += 1;
        },
      },
    );

    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      timeout?: boolean;
      assistantMessage?: { status: string };
    };
    expect(sleepCalls).toBe(0);
    expect(written.timeout).toBeUndefined();
    expect(written.assistantMessage?.status).toBe("failed");
  });

  it("uses request timeout overrides and emits heartbeat logs while polling", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const { requestPath } = providerSmokePaths(tempDir, "chatgpt");
    await mkdir(path.dirname(requestPath), { recursive: true });
    await writeFile(requestPath, "{\"provider\":\"chatgpt\",\"timeoutMs\":20}", "utf8");

    let currentTime = 0;
    const logs: string[] = [];
    await runProviderSmokeTest(
      {
        snapshot: () => ({
          ...createSnapshot("chatgpt"),
          conversations: [{
            id: "conversation-heartbeat",
            title: "Smoke",
            provider: "chatgpt",
            hidden: false,
            pinned: false,
            documentIds: [],
            tagIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [createUserMessage("chatgpt", "conversation-heartbeat", "waiting")],
          }],
        }),
        createConversation: async () => ({
          id: "conversation-heartbeat",
          title: "Smoke",
          provider: "chatgpt",
          hidden: false,
          pinned: false,
          documentIds: [],
          tagIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        }),
        sendMessage: async () => undefined,
        submitProviderEnter: async () => undefined,
        deleteMessage: () => undefined,
        syncLatestProviderResponse: async () => false,
        setWebsiteVisible: async () => undefined,
        getSettings: () => ({}),
        setSettings: () => undefined,
        getProviderDebugSnapshot: async () => createDebugSnapshot("chatgpt"),
        listProviderAdapterEvents: () => [],
      },
      tempDir,
      undefined,
      {
        pollIntervalMs: 5,
        heartbeatEvery: 2,
        now: () => currentTime,
        sleep: async (ms) => {
          currentTime += ms;
        },
        log: async (message) => {
          logs.push(message);
        },
      },
    );

    const { resultPath } = providerSmokePaths(tempDir, "chatgpt");
    const written = JSON.parse(await readFile(resultPath, "utf8")) as {
      stage?: string;
      pollCount?: number;
      timeout?: boolean;
      verification?: { kind: string };
    };
    expect(logs.some((message) => message.includes("timeoutMs=20"))).toBe(true);
    expect(logs.some((message) => message.includes("heartbeat polls=2"))).toBe(true);
    expect(written.timeout).toBe(true);
    expect(written.pollCount).toBe(4);
    expect(written.verification?.kind).toBe("timeout");
  });

  it("derives auth-blocked verification and phase trace from smoke diagnostics", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-"));
    const outputPath = path.join(tempDir, "provider-smoke-chatgpt.json");
    const now = new Date().toISOString();

    await writeProviderSmokeResult(
      outputPath,
      {
        provider: "chatgpt",
        token: "AIHUB_CHATGPT_456",
        sendError: "Login or provider verification is required before sending.",
        userMessage: {
          ...createUserMessage("chatgpt", "conversation-auth", "blocked"),
          status: "failed",
          statusPhase: "checking-auth",
          statusDetail: "Login or provider verification is required before sending.",
          errorCode: "auth_required",
        },
      },
      {
        providerSummary: {
          ...createSnapshot("chatgpt").providers[0]!,
          authenticated: false,
          ready: false,
          reason: "Login or provider verification is required before sending.",
          lastFailurePhase: "checking-auth",
          lastFailureCode: "auth_required",
        },
        debugSnapshot: {
          ...createDebugSnapshot("chatgpt"),
          completionDecision: "fail code=auth_required phase=checking-auth",
        },
        adapterEvents: [
          {
            id: 1,
            provider: "chatgpt",
            type: "message.status",
            detail: "{\"phase\":\"checking-auth\"}",
            createdAt: now,
          },
          {
            id: 2,
            provider: "chatgpt",
            type: "generation.failed",
            detail: "{\"code\":\"auth_required\"}",
            createdAt: now,
          },
        ],
      },
    );

    const written = JSON.parse(await readFile(outputPath, "utf8")) as {
      verification?: {
        kind: string;
        phaseTrace: string[];
        diagnosed: boolean;
        synchronized: boolean;
        notes: string[];
      };
    };
    expect(written.verification).toMatchObject({
      kind: "auth-blocked",
      phaseTrace: ["checking-auth"],
      diagnosed: true,
      synchronized: false,
    });
    expect(written.verification?.notes.some((note) => note.includes("failureCode=auth_required"))).toBe(true);
  });
});

function createSnapshot(provider: ProviderId): AppSnapshot {
  return {
    providers: [{
      id: provider,
      authenticated: true,
      ready: true,
      degraded: false,
      websiteVisible: true,
    }],
    conversations: [],
    comparisons: [],
  };
}

function createDebugSnapshot(provider: ProviderId): ProviderDebugSnapshot {
  return {
    provider,
    url: "https://example.com/chat",
    composer: "textarea",
    submit: "button",
    anchor: "div:3",
    assistant: "div:4",
    latestTextLength: 4,
    isGenerating: false,
    networkActiveCount: 0,
    networkIdle: true,
    lastMutationAt: 10,
    completionDecision: "complete",
    completionSignals: {
      textLength: 4,
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: true,
      hasRecoverableBlocker: false,
      stableMs: 100,
      elapsedMs: 200,
    },
    fallbackUsed: false,
  };
}

function createUserMessage(
  provider: ProviderId,
  conversationId: string,
  text: string,
) {
  return {
    id: `${conversationId}-user`,
    conversationId,
    role: "user" as const,
    content: [{ type: "text" as const, text }],
    status: "completed" as const,
    statusPhase: "completed" as const,
    provider,
    createdAt: new Date().toISOString(),
  };
}

function createAssistantMessage(
  provider: ProviderId,
  conversationId: string,
  text: string,
) {
  return {
    id: `${conversationId}-assistant`,
    conversationId,
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    status: "completed" as const,
    statusPhase: "completed" as const,
    provider,
    createdAt: new Date().toISOString(),
  };
}
