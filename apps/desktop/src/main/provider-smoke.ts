import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import {
  PROVIDER_IDS,
  messageToText,
  providerSmokeDiagnosticsSchema,
  providerSmokeTestRequestSchema,
  providerSmokeTestResultSchema,
  type ProviderSendPhase,
  type ProviderSmokeRuntimeInfo,
  type ProviderSmokeScenario,
  type ProviderSmokeVerification,
  type ProviderId,
  type ProviderSmokeDiagnostics,
  type ProviderSmokeTestRequest,
  type ProviderSmokeTestResult,
} from "@aihub/core";
import type { AppService } from "./app-service";

export interface ProviderSmokePaths {
  diagnosticsDir: string;
  requestPath: string;
  resultPath: string;
}

export interface ProviderSmokeRunOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  heartbeatEvery?: number;
  runtime?: ProviderSmokeRuntimeInfo;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void | Promise<void>;
  backgroundSettleMs?: number;
}

export function providerSmokePaths(
  userDataDir: string,
  provider: ProviderId,
  scenario: ProviderSmokeScenario = "normal-send",
): ProviderSmokePaths {
  const diagnosticsDir = path.join(userDataDir, "diagnostics");
  const scenarioSuffix = scenario === "normal-send" ? "" : `-${scenario}`;
  return {
    diagnosticsDir,
    requestPath: path.join(diagnosticsDir, "provider-smoke-request.json"),
    resultPath: path.join(
      diagnosticsDir,
      `provider-smoke-${provider}${scenarioSuffix}.json`,
    ),
  };
}

export async function readProviderSmokeRequest(
  requestPath: string,
): Promise<ProviderSmokeTestRequest | undefined> {
  try {
    const raw = (await readFile(requestPath, "utf8")).replace(/^\uFEFF/, "");
    return providerSmokeTestRequestSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export async function collectProviderSmokeDiagnostics(
  appService: Pick<AppService, "snapshot" | "getProviderDebugSnapshot" | "listProviderAdapterEvents">,
  provider: ProviderId,
  options: {
    sinceCreatedAt?: string;
  } = {},
): Promise<ProviderSmokeDiagnostics> {
  const providerSummary = appService.snapshot().providers.find(
    (item) => item.id === provider,
  );
  let debugSnapshot;
  let debugSnapshotError: string | undefined;
  try {
    debugSnapshot = await appService.getProviderDebugSnapshot(provider);
  } catch (error) {
    debugSnapshotError = error instanceof Error ? error.message : String(error);
  }
  return providerSmokeDiagnosticsSchema.parse({
    providerSummary,
    debugSnapshot,
    debugSnapshotError,
    adapterEventSinceCreatedAt: options.sinceCreatedAt,
    adapterEvents: appService.listProviderAdapterEvents(provider, 500, options.sinceCreatedAt),
  });
}

export async function writeProviderSmokeResult(
  outputPath: string,
  result: Omit<ProviderSmokeTestResult, "diagnostics">,
  diagnostics: ProviderSmokeDiagnostics,
): Promise<ProviderSmokeTestResult> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const parsed = providerSmokeTestResultSchema.parse({
    ...result,
    diagnostics,
    verification: buildProviderSmokeVerification(result, diagnostics),
  });
  await writeFile(outputPath, JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

function buildProviderSmokeVerification(
  result: Omit<ProviderSmokeTestResult, "diagnostics">,
  diagnostics: ProviderSmokeDiagnostics,
): ProviderSmokeVerification | undefined {
  if (result.stage === "started" || result.stage === "running") {
    return undefined;
  }

  const phaseTrace = diagnostics.adapterEvents
    .slice()
    .sort((left, right) => left.id - right.id)
    .filter((event) => event.type === "message.status" && event.detail)
    .map((event) => {
      try {
        const parsed = JSON.parse(event.detail ?? "") as { phase?: ProviderSendPhase };
        return parsed.phase;
      } catch {
        return undefined;
      }
    })
    .filter((phase): phase is ProviderSendPhase => Boolean(phase))
    .filter((phase, index, items) => index === 0 || items[index - 1] !== phase);

  const lastFailurePhase = diagnostics.providerSummary?.lastFailurePhase;
  const lastFailureCode = diagnostics.providerSummary?.lastFailureCode;
  const reason = diagnostics.providerSummary?.reason ?? result.sendError ?? result.error;
  const notes: string[] = [];

  if (lastFailurePhase) notes.push(`failurePhase=${lastFailurePhase}`);
  if (lastFailureCode) notes.push(`failureCode=${lastFailureCode}`);
  if (reason) notes.push(`reason=${reason}`);
  if (diagnostics.debugSnapshot?.completionDecision) {
    notes.push(`decision=${diagnostics.debugSnapshot.completionDecision}`);
  }

  const diagnosed = Boolean(lastFailurePhase || lastFailureCode || reason);
  const terminalCompleted =
    result.userMessage?.status === "completed" &&
    result.assistantMessage?.status === "completed";
  const assistantText = result.assistantMessage
    ? messageToText(result.assistantMessage)
    : "";
  const tokenMatched = !result.token || assistantText.includes(result.token);
  const synchronized = terminalCompleted && tokenMatched;

  if (synchronized) {
    return {
      kind: result.scenario === "manual-recovery"
        ? "manual-recovery-completed"
        : result.scenario === "resync-latest" && result.resyncSucceeded
          ? "resync-latest-completed"
          : result.scenario === "background-send"
            ? "background-send-completed"
            : "normal-send-completed",
      phaseTrace,
      diagnosed: true,
      synchronized: true,
      notes,
    };
  }

  if (terminalCompleted && !tokenMatched) {
    return {
      kind: "content-mismatch",
      phaseTrace,
      diagnosed: true,
      synchronized: false,
      notes: [
        ...notes,
        `expectedTokenMissing=${result.token}`,
        `assistantTextLength=${assistantText.length}`,
      ],
    };
  }

  if (result.timeout) {
    return {
      kind: "timeout",
      phaseTrace,
      diagnosed,
      synchronized: false,
      notes,
    };
  }

  if (result.error) {
    return {
      kind: "fatal-error",
      phaseTrace,
      diagnosed: true,
      synchronized: false,
      notes,
    };
  }

  if (lastFailureCode === "auth_required" || lastFailurePhase === "checking-auth") {
    return {
      kind: "auth-blocked",
      phaseTrace,
      diagnosed: true,
      synchronized: false,
      notes,
    };
  }

  if (lastFailurePhase === "recoverable-blocked") {
    return {
      kind: "recoverable-blocked",
      phaseTrace,
      diagnosed,
      synchronized: false,
      notes,
    };
  }

  return {
    kind: "unclassified-failure",
    phaseTrace,
    diagnosed,
    synchronized: false,
    notes,
  };
}

export async function runProviderSmokeTest(
  appService: Pick<AppService,
    | "snapshot"
    | "createConversation"
    | "sendMessage"
    | "submitProviderEnter"
    | "deleteMessage"
    | "syncLatestProviderResponse"
    | "setWebsiteVisible"
    | "getSettings"
    | "setSettings"
    | "getProviderDebugSnapshot"
    | "listProviderAdapterEvents">,
  userDataDir: string,
  envProvider = process.env.AIHUB_SMOKE_TEST_PROVIDER,
  options: ProviderSmokeRunOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestPath = path.join(userDataDir, "diagnostics", "provider-smoke-request.json");
  const request = await readProviderSmokeRequest(requestPath);
  const timeoutMs = request?.timeoutMs ?? options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const heartbeatEvery = Math.max(1, options.heartbeatEvery ?? 10);
  const backgroundSettleMs = options.backgroundSettleMs ?? 31_000;
  const log = options.log ?? (() => undefined);
  const provider = request?.provider ?? envProvider as ProviderId | undefined;
  const scenario = request?.scenario ?? "normal-send";
  const runtime = options.runtime;
  await log(`provider-smoke: requestPath=${requestPath} request=${request ? request.provider : "none"} scenario=${scenario} env=${envProvider ?? "none"} timeoutMs=${timeoutMs}`);
  if (!provider || !PROVIDER_IDS.includes(provider)) return;

  const { diagnosticsDir, resultPath } = providerSmokePaths(
    userDataDir,
    provider,
    scenario,
  );
  const token = `AIHUB_${provider.toUpperCase()}_${now()}`;
  const startedAt = new Date().toISOString();
  let resyncAttempted = false;
  let resyncSucceeded = false;
  const verifiesResync = scenario === "resync-latest" || scenario === "background-send";
  const originalSettings = scenario === "manual-recovery"
    ? appService.getSettings()
    : undefined;
  await log(`provider-smoke: provider=${provider} resultPath=${resultPath} token=${token}`);

  const writeResult = async (
    data: Omit<ProviderSmokeTestResult, "diagnostics">,
  ) => {
    const diagnostics = await collectProviderSmokeDiagnostics(appService, provider, {
      sinceCreatedAt: startedAt,
    });
    await writeProviderSmokeResult(resultPath, {
      ...data,
      scenario,
      resyncAttempted: verifiesResync
        ? resyncAttempted
        : undefined,
      resyncSucceeded: verifiesResync
        ? resyncSucceeded
        : undefined,
      runtime,
    }, diagnostics);
  };

  try {
    if (request) {
      await mkdir(diagnosticsDir, { recursive: true });
      await unlink(requestPath).catch(() => undefined);
      await log(`provider-smoke: consumed request ${requestPath}`);
    }
    await writeResult({
      provider,
      scenario,
      token,
      stage: "started",
      startedAt,
    });
    await log(`provider-smoke: wrote started result`);
    if (scenario === "manual-recovery") {
      appService.setSettings({
        ...originalSettings,
        providerBackends: {
          ...originalSettings?.providerBackends,
          [provider]: "manual",
        },
      });
      await log(`provider-smoke: selected manual backend`);
    }
    const websiteVisible = scenario !== "background-send";
    await appService.setWebsiteVisible(provider, websiteVisible);
    await log(
      `provider-smoke: provider page visibility=${websiteVisible}; scenario=${scenario}`,
    );
    if (scenario === "background-send") {
      await sleep(backgroundSettleMs);
      await log(
        `provider-smoke: background detach window elapsed (${backgroundSettleMs}ms)`,
      );
    }
    const conversation = await appService.createConversation(provider);
    await log(`provider-smoke: created conversation ${conversation.id}`);
    const text = request?.prompt
      ? `${token}\n${request.prompt}`
      : `${token}\nReturn exactly this token: ${token}`;
    let sendError: string | null = null;
    try {
      await appService.sendMessage({
        provider,
        conversationId: conversation.id,
        text,
        modes: request?.modes,
      });
      await log(`provider-smoke: sendMessage submitted`);
      if (scenario === "manual-recovery") {
        await appService.submitProviderEnter(provider);
        await log(`provider-smoke: manual recovery submitted through provider page`);
      }
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
      await log(`provider-smoke: sendMessage error=${sendError}`);
    }

    const deadline = now() + timeoutMs;
    let pollCount = 0;
    while (now() < deadline) {
      const current = appService.snapshot().conversations.find(
        (item) => item.id === conversation.id,
      );
      const messages = current?.messages ?? [];
      const userMessage = messages.find((item) => item.role === "user");
      const assistantMessage = [...messages]
        .reverse()
        .find((item) => item.role === "assistant");
      if (
        (assistantMessage?.status === "completed" &&
          (!verifiesResync || resyncAttempted)) ||
        assistantMessage?.status === "failed" ||
        userMessage?.status === "failed"
      ) {
        await log(`provider-smoke: terminal state user=${userMessage?.status ?? "none"} assistant=${assistantMessage?.status ?? "none"}`);
        await writeResult({
          provider,
          token,
          sendError,
          userMessage,
          assistantMessage,
        });
        return;
      }
      if (
        verifiesResync &&
        !resyncAttempted &&
        assistantMessage?.status === "completed"
      ) {
        resyncAttempted = true;
        appService.deleteMessage(conversation.id, assistantMessage.id);
        await log(`provider-smoke: deleted local assistant to simulate a missed reply`);
        resyncSucceeded = await appService.syncLatestProviderResponse(provider);
        await log(`provider-smoke: resync latest response result=${resyncSucceeded}`);
        continue;
      }
      pollCount += 1;
      if (pollCount % heartbeatEvery === 0) {
        await log(
          `provider-smoke: heartbeat polls=${pollCount} user=${userMessage?.status ?? "none"} assistant=${assistantMessage?.status ?? "none"} messages=${messages.length}`,
        );
        await writeResult({
          provider,
          token,
          stage: "running",
          startedAt,
          heartbeatAt: new Date().toISOString(),
          pollCount,
          sendError,
          userMessage,
          assistantMessage,
          conversation: current,
        });
      }
      await sleep(pollIntervalMs);
    }

    const current = appService.snapshot().conversations.find(
      (item) => item.id === conversation.id,
    );
    await log(`provider-smoke: timeout waiting for result`);
    await writeResult({
      provider,
      token,
      sendError,
      heartbeatAt: new Date().toISOString(),
      pollCount,
      conversation: current,
      timeout: true,
    });
  } catch (error) {
    await log(`provider-smoke: fatal error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    await writeResult({
      provider,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } finally {
    if (originalSettings) {
      appService.setSettings(originalSettings);
      await log(`provider-smoke: restored provider settings`);
    }
  }
}
