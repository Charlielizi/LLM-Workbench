import { describe, expect, it } from "vitest";
import {
  messageStatusDetail,
  messageStatusLabel,
} from "../src/renderer/utils/message-status";

describe("message-status", () => {
  it("maps auth failures to a user-facing label and detail", () => {
    expect(messageStatusLabel({
      status: "failed",
      statusPhase: "checking-auth",
      errorCode: "auth_required",
    })).toBe("Sign-in required");

    expect(messageStatusDetail({
      status: "failed",
      statusDetail: "Login or provider verification is blocking the composer.",
      errorCode: "auth_required",
    })).toBe("Open the provider drawer and complete sign-in.");
  });

  it("maps pending phases to readable labels", () => {
    expect(messageStatusLabel({
      status: "pending",
      statusPhase: "submitting",
      errorCode: undefined,
    })).toBe("Submitting");
  });

  it("distinguishes external and client failures", () => {
    expect(messageStatusLabel({
      status: "failed",
      statusPhase: "failed",
      errorCode: "provider_external_failure",
      failureOrigin: "external",
    })).toBe("Provider unavailable");
    expect(messageStatusLabel({
      status: "failed",
      statusPhase: "confirming-submit",
      errorCode: "provider_submit_not_confirmed",
      failureOrigin: "client",
    })).toBe("AIHub interaction failed");
  });

  it("surfaces recoverable blocked messages even when they were persisted as completed", () => {
    expect(messageStatusLabel({
      status: "completed",
      statusPhase: "recoverable-blocked",
      errorCode: undefined,
    })).toBe("Ready in provider page");

    expect(messageStatusDetail({
      status: "completed",
      statusPhase: "recoverable-blocked",
      statusDetail: "Prompt was filled in the provider page. Review and submit it manually.",
      errorCode: undefined,
    })).toBe("Prompt was filled in the provider page. Review and submit it manually.");
  });
});
