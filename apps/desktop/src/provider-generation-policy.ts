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

export function resolveGenerationCheck(input: {
  text: string;
  hasStopButton: boolean;
  hasStreamingIndicator: boolean;
  startedAt: number;
  lastMutationAt: number;
}): GenerationDecision {
  const now = Date.now();
  if (
    !input.text &&
    !input.hasStopButton &&
    !input.hasStreamingIndicator &&
    now - input.startedAt >= 120_000
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
    now - input.lastMutationAt >= 2_500
  ) {
    return { type: "complete" };
  }
  return { type: "retry" };
}
