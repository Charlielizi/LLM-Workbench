import type {
  AdapterEventRecord,
  ProviderDebugSnapshot,
  ProviderSmokeInspection,
  ProviderSmokeTestResult,
  ProviderSummary,
} from "@aihub/core";

export function formatProviderDiagnostics(
  provider: ProviderSummary | undefined,
  snapshot: ProviderDebugSnapshot,
  events: AdapterEventRecord[],
  smokeInspection?: ProviderSmokeInspection | null,
  smokeResult?: ProviderSmokeTestResult | null,
): string {
  const lines = [
    `provider=${snapshot.provider}`,
    `state=${provider?.authenticated ? "authenticated" : "unauthenticated"} degraded=${provider?.degraded ?? false} visible=${provider?.websiteVisible ?? false}`,
    `failurePhase=${provider?.lastFailurePhase ?? "none"}`,
    `failureCode=${provider?.lastFailureCode ?? "none"}`,
    `failureOrigin=${provider?.lastFailureOrigin ?? "none"}`,
    `reason=${provider?.reason ?? "none"}`,
    `url=${snapshot.url}`,
    `composer=${snapshot.composer}`,
    `submit=${snapshot.submit}`,
    `anchor=${snapshot.anchor}`,
    `assistant=${snapshot.assistant}`,
    `message=${snapshot.activeMessageId ?? "none"}`,
    `binding=${snapshot.assistantBinding ?? "none"}`,
    `fallback=${snapshot.fallbackUsed}`,
    `latestTextLength=${snapshot.latestTextLength}`,
    `isGenerating=${snapshot.isGenerating}`,
    `lastMutationAt=${snapshot.lastMutationAt}`,
    `network=${snapshot.networkIdle ? "idle" : "active"} count=${snapshot.networkActiveCount}`,
    `networkUrl=${snapshot.lastNetworkUrl ?? "none"}`,
    `decision=${snapshot.completionDecision}`,
    `submitCandidates=${snapshot.submitCandidates?.length ? snapshot.submitCandidates.join(" || ") : "none"}`,
    [
      `signals=text=${snapshot.completionSignals.textLength}`,
      `stop=${snapshot.completionSignals.hasStopButton}`,
      `streaming=${snapshot.completionSignals.hasStreamingIndicator}`,
      `blocker=${snapshot.completionSignals.hasRecoverableBlocker}`,
      snapshot.completionSignals.recoverableBlockerReason
        ? `reason=${snapshot.completionSignals.recoverableBlockerReason}`
        : "",
      `stableMs=${snapshot.completionSignals.stableMs}`,
      `elapsedMs=${snapshot.completionSignals.elapsedMs}`,
    ].filter(Boolean).join(" "),
    `smokeInspection=${smokeInspection?.status ?? "none"}`,
    `smokeCurrentRuntime=${smokeInspection?.currentRuntime ? `${smokeInspection.currentRuntime.instanceId} pid=${smokeInspection.currentRuntime.pid} startedAt=${smokeInspection.currentRuntime.startedAt}` : "none"}`,
    `smokeStaleRuntime=${smokeInspection?.staleRuntimeInstanceId ?? "none"}`,
    `smokeRuntime=${smokeResult?.runtime ? `${smokeResult.runtime.instanceId} pid=${smokeResult.runtime.pid} startedAt=${smokeResult.runtime.startedAt}` : "none"}`,
    `smokeVerification=${smokeResult?.verification?.kind ?? "none"}`,
    `smokePhaseTrace=${smokeResult?.verification?.phaseTrace?.join(" -> ") ?? "none"}`,
    `smokeToken=${smokeResult?.token ?? "none"}`,
    `smokeEventSince=${smokeResult?.diagnostics.adapterEventSinceCreatedAt ?? "none"}`,
    "events:",
    ...events.map((event) => `- ${event.createdAt} ${event.type} ${event.detail ?? ""}`.trim()),
  ];
  return lines.join("\n");
}
