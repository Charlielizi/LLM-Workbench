import { describe, expect, it, vi } from "vitest";
import {
  describeCompletionSignals,
  resolveGenerationCheck,
} from "../src/provider-generation-policy";

describe("provider-generation-policy", () => {
  function at(iso: string): number {
    return Date.parse(iso);
  }

  it("completes when streaming has been idle and stop button is gone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:11.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:08.000Z"),
    })).toEqual({ type: "complete" });
    vi.useRealTimers();
  });

  it("fails when the provider becomes idle without any detected reply", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:02:30.000Z"));

    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
    })).toMatchObject({
      type: "fail",
      code: "provider_response_not_detected",
      phase: "waiting-first-token",
    });
    vi.useRealTimers();
  });

  it("honors a provider-specific first-token timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:03:00.000Z"));

    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
      firstTokenTimeoutMs: 300_000,
    })).toEqual({ type: "retry" });

    vi.setSystemTime(new Date("2026-06-27T12:05:00.000Z"));
    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
      firstTokenTimeoutMs: 300_000,
    })).toMatchObject({
      type: "fail",
      code: "provider_response_not_detected",
    });
    vi.useRealTimers();
  });

  it("does not complete while the provider still exposes a streaming indicator", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:10.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: false,
      hasStreamingIndicator: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:07.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("does not complete while the provider still exposes a stop button", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:10.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: true,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:07.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("fails a provider generation that remains stalled behind a stop button", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:05:02.000Z"));

    expect(resolveGenerationCheck({
      text: "AI",
      hasStopButton: true,
      hasStreamingIndicator: false,
      networkIdle: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:02.000Z"),
    })).toEqual({
      type: "fail",
      code: "provider_generation_stalled",
      phase: "streaming",
      detail:
        "The provider stopped producing output while its page still appeared to be generating.",
    });
    vi.useRealTimers();
  });

  it("keeps waiting for a slow provider before the stall timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:04:59.000Z"));

    expect(resolveGenerationCheck({
      text: "AI",
      hasStopButton: true,
      hasStreamingIndicator: false,
      networkIdle: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:02.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("enforces the ten-minute per-round generation cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:10:00.000Z"));

    expect(resolveGenerationCheck({
      text: "still changing",
      hasStopButton: true,
      hasStreamingIndicator: true,
      networkIdle: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:09:59.000Z"),
      totalTimeoutMs: 600_000,
    })).toMatchObject({
      type: "fail",
      code: "provider_generation_timed_out",
      phase: "streaming",
    });
    vi.useRealTimers();
  });

  it("does not complete before the text has been stable long enough", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:10.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:08.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("honors a provider-specific completion stability threshold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:15.000Z"));

    expect(resolveGenerationCheck({
      text: "partial long answer",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:08.000Z"),
      stableThresholdMs: 10_000,
    })).toEqual({ type: "retry" });

    vi.setSystemTime(new Date("2026-06-27T12:00:18.000Z"));
    expect(resolveGenerationCheck({
      text: "complete long answer",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:08.000Z"),
      stableThresholdMs: 10_000,
    })).toEqual({ type: "complete" });
    vi.useRealTimers();
  });

  it("does not complete until target network activity becomes idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:11.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:08.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("does not fail waiting for first token while target network is still active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:02:30.000Z"));

    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("does not fail waiting for first token while stop or streaming indicators remain", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:02:30.000Z"));

    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: true,
      hasStreamingIndicator: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
    })).toEqual({ type: "retry" });
    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: true,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:00.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });

  it("fails with a recoverable blocked phase when login or verification blocks the page", () => {
    expect(resolveGenerationCheck({
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      hasRecoverableBlocker: true,
      recoverableBlockerReason: "Verification required. Try again.",
      startedAt: Date.now(),
      lastMutationAt: Date.now(),
    })).toMatchObject({
      type: "fail",
      code: "provider_recoverable_blocked",
      phase: "recoverable-blocked",
      detail: "Verification required. Try again.",
    });
  });

  it("describes completion signals for debug snapshots", () => {
    const decision = { type: "retry" as const };
    const description = describeCompletionSignals(decision, {
      text: "hello",
      hasStopButton: true,
      hasStreamingIndicator: false,
      networkIdle: false,
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:03.000Z"),
    }, at("2026-06-27T12:00:05.000Z"));

    expect(description).toBe(
      "retry text=5 stop=true streaming=false network=active stableMs=2000 elapsedMs=5000",
    );
  });

  it("includes blocker reason in debug signal descriptions", () => {
    const description = describeCompletionSignals({
      type: "fail",
      code: "provider_recoverable_blocked",
      phase: "recoverable-blocked",
      detail: "Verification required. Try again.",
    }, {
      text: "",
      hasStopButton: false,
      hasStreamingIndicator: false,
      networkIdle: true,
      hasRecoverableBlocker: true,
      recoverableBlockerReason: "Verification required. Try again.",
      startedAt: at("2026-06-27T12:00:00.000Z"),
      lastMutationAt: at("2026-06-27T12:00:03.000Z"),
    }, at("2026-06-27T12:00:05.000Z"));

    expect(description).toBe(
      "fail text=0 stop=false streaming=false network=idle stableMs=2000 elapsedMs=5000 blocker=true reason=Verification required. Try again. code=provider_recoverable_blocked phase=recoverable-blocked",
    );
  });
});
