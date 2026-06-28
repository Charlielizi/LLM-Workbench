import { describe, expect, it, vi } from "vitest";
import { resolveGenerationCheck } from "../src/provider-generation-policy";

describe("provider-generation-policy", () => {
  it("completes when streaming has been idle and stop button is gone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:11.000Z"));

    expect(resolveGenerationCheck({
      text: "hello",
      hasStopButton: false,
      hasStreamingIndicator: false,
      startedAt: Date.parse("2026-06-27T12:00:00.000Z"),
      lastMutationAt: Date.parse("2026-06-27T12:00:08.000Z"),
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
      startedAt: Date.parse("2026-06-27T12:00:00.000Z"),
      lastMutationAt: Date.parse("2026-06-27T12:00:00.000Z"),
    })).toMatchObject({
      type: "fail",
      code: "provider_response_not_detected",
      phase: "waiting-first-token",
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
      startedAt: Date.parse("2026-06-27T12:00:00.000Z"),
      lastMutationAt: Date.parse("2026-06-27T12:00:07.000Z"),
    })).toEqual({ type: "retry" });
    vi.useRealTimers();
  });
});
