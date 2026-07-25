import { describe, expect, it } from "vitest";
import { formatProviderDiagnostics } from "../src/renderer/utils/provider-diagnostics";

describe("provider-diagnostics", () => {
  it("formats snapshot and adapter events into a copyable debug report", () => {
    const text = formatProviderDiagnostics({
      id: "chatgpt",
      authenticated: false,
      ready: false,
      degraded: false,
      reason: "Login required",
      lastFailurePhase: "checking-auth",
      lastFailureCode: "auth_required",
      websiteVisible: true,
    }, {
      provider: "chatgpt",
      url: "https://chatgpt.com/c/123",
      composer: "textarea visible=true text=0",
      submit: "button visible=true text=4",
      submitCandidates: [
        "button visible=true text=4 label=Send dx=12 dy=4",
        "button visible=true text=0 label=Attach dx=-20 dy=4",
      ],
      anchor: "div:assistant:3",
      assistant: "div visible=true text=42",
      activeMessageId: "provider-message",
      assistantBinding: "bound-after-anchor:3->4",
      latestTextLength: 42,
      isGenerating: false,
      networkActiveCount: 1,
      networkIdle: false,
      lastNetworkUrl: "https://chatgpt.com/backend-api/conversation",
      lastMutationAt: 123,
      completionDecision: "retry text=42 stop=false streaming=false network=active",
      completionSignals: {
        textLength: 42,
        hasStopButton: false,
        hasStreamingIndicator: false,
        networkIdle: false,
        hasRecoverableBlocker: false,
        recoverableBlockerReason: undefined,
        stableMs: 1200,
        elapsedMs: 4500,
      },
      fallbackUsed: false,
    }, [
      {
        id: 1,
        provider: "chatgpt",
        type: "provider.network-started",
        detail: "https://chatgpt.com/backend-api/conversation",
        createdAt: "2026-07-07T06:00:00.000Z",
      },
    ], {
      provider: "chatgpt",
      status: "stale",
      currentRuntime: {
        instanceId: "current-runtime",
        pid: 4321,
        startedAt: "2026-07-10T03:02:52.590Z",
      },
      staleRuntimeInstanceId: "old-runtime",
    }, {
      provider: "chatgpt",
      runtime: {
        instanceId: "runtime-1",
        pid: 1234,
        startedAt: "2026-07-10T01:00:00.000Z",
      },
      diagnostics: {
        adapterEvents: [],
      },
    });

    expect(text).toContain("provider=chatgpt");
    expect(text).toContain("failurePhase=checking-auth");
    expect(text).toContain("failureCode=auth_required");
    expect(text).toContain("reason=Login required");
    expect(text).toContain("message=provider-message");
    expect(text).toContain("binding=bound-after-anchor:3->4");
    expect(text).toContain("latestTextLength=42");
    expect(text).toContain("isGenerating=false");
    expect(text).toContain("lastMutationAt=123");
    expect(text).toContain("networkUrl=https://chatgpt.com/backend-api/conversation");
    expect(text).toContain("submitCandidates=button visible=true text=4 label=Send dx=12 dy=4 || button visible=true text=0 label=Attach dx=-20 dy=4");
    expect(text).toContain("blocker=false");
    expect(text).toContain("smokeInspection=stale");
    expect(text).toContain("smokeCurrentRuntime=current-runtime pid=4321 startedAt=2026-07-10T03:02:52.590Z");
    expect(text).toContain("smokeStaleRuntime=old-runtime");
    expect(text).toContain("smokeRuntime=runtime-1 pid=1234 startedAt=2026-07-10T01:00:00.000Z");
    expect(text).toContain("events:");
    expect(text).toContain("provider.network-started");
  });
});
