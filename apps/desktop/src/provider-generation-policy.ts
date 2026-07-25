import type { ProviderSendPhase } from "@aihub/core";

export type GenerationDecision =
  | { type: "retry" }
  | { type: "complete" }
  | {
      type: "fail";
      code: string;
      phase: ProviderSendPhase;
      detail: string;
    };

export interface CompletionSignals {
  text: string;
  hasStopButton: boolean;
  hasStreamingIndicator: boolean;
  networkIdle?: boolean;
  hasRecoverableBlocker?: boolean;
  recoverableBlockerReason?: string;
  startedAt: number;
  lastMutationAt: number;
  firstTokenTimeoutMs?: number;
  stableThresholdMs?: number;
  stallTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export function describeCompletionSignals(
  decision: GenerationDecision,
  input: CompletionSignals,
  now = Date.now(),
): string {
  const networkIdle = input.networkIdle ?? true;
  const stableMs = Math.max(0, now - input.lastMutationAt);
  const elapsedMs = Math.max(0, now - input.startedAt);
  const parts = [
    decision.type,
    `text=${input.text.length}`,
    `stop=${input.hasStopButton}`,
    `streaming=${input.hasStreamingIndicator}`,
    `network=${networkIdle ? "idle" : "active"}`,
    `stableMs=${stableMs}`,
    `elapsedMs=${elapsedMs}`,
  ];
  if (input.hasRecoverableBlocker) parts.push("blocker=true");
  if (input.recoverableBlockerReason) {
    parts.push(`reason=${input.recoverableBlockerReason}`);
  }
  if (decision.type === "fail") {
    parts.push(`code=${decision.code}`);
    parts.push(`phase=${decision.phase}`);
  }
  return parts.join(" ");
}

export function resolveGenerationCheck(input: CompletionSignals): GenerationDecision {
  const now = Date.now();
  if (input.hasRecoverableBlocker) {
    return {
      type: "fail",
      code: "provider_recoverable_blocked",
      phase: "recoverable-blocked",
      detail:
        input.recoverableBlockerReason ||
        "The provider page is blocked by login, verification, or a recoverable modal.",
    };
  }
  const networkIdle = input.networkIdle ?? true;
  const firstTokenTimeoutMs = input.firstTokenTimeoutMs ?? 120_000;
  const stableThresholdMs = input.stableThresholdMs ?? 2_500;
  const stallTimeoutMs = input.stallTimeoutMs ?? 300_000;
  const totalTimeoutMs = input.totalTimeoutMs ?? 600_000;
  if (now - input.startedAt >= totalTimeoutMs) {
    return {
      type: "fail",
      code: "provider_generation_timed_out",
      phase: input.text ? "streaming" : "waiting-first-token",
      detail: "The provider generation exceeded the ten-minute round limit.",
    };
  }
  if (
    (Boolean(input.text) ||
      input.hasStopButton ||
      input.hasStreamingIndicator) &&
    networkIdle &&
    now - input.startedAt >= stallTimeoutMs &&
    now - input.lastMutationAt >= stallTimeoutMs
  ) {
    return {
      type: "fail",
      code: "provider_generation_stalled",
      phase: input.text ? "streaming" : "waiting-first-token",
      detail:
        "The provider stopped producing output while its page still appeared to be generating.",
    };
  }
  if (
    !input.text &&
    !input.hasStopButton &&
    !input.hasStreamingIndicator &&
    networkIdle &&
    now - input.startedAt >= firstTokenTimeoutMs
  ) {
    return {
      type: "fail",
      code: "provider_response_not_detected",
      phase: "waiting-first-token",
      detail: "No assistant response was detected before the provider became idle.",
    };
  }
  if (
    input.text &&
    !input.hasStopButton &&
    !input.hasStreamingIndicator &&
    networkIdle &&
    now - input.lastMutationAt >= stableThresholdMs
  ) {
    return { type: "complete" };
  }
  return { type: "retry" };
}
