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
});
