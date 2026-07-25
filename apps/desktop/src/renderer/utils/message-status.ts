import type { NormalizedMessage, ProviderSendPhase } from "@aihub/core";

const phaseLabels: Partial<Record<ProviderSendPhase, string>> = {
  "checking-auth": "Checking sign-in",
  "capturing-anchor": "Finding conversation position",
  "configuring-model": "Selecting model",
  "configuring-modes": "Configuring tools",
  "preparing-attachments": "Preparing attachments",
  "uploading-attachments": "Uploading attachments",
  "typing-message": "Typing message",
  "submitting": "Submitting",
  "confirming-submit": "Confirming submit",
  "binding-assistant": "Finding reply",
  "waiting-first-token": "Waiting for reply",
  "streaming": "Receiving reply",
  "detecting-completion": "Checking completion",
  "recoverable-blocked": "Provider needs attention",
  "completed": "Completed",
  "failed": "Failed",
};

export function messageStatusLabel(message: Pick<
  NormalizedMessage,
  "status" | "statusPhase" | "errorCode" | "failureOrigin"
>): string | undefined {
  if (message.statusPhase === "recoverable-blocked") {
    return "Ready in provider page";
  }
  if (message.status === "pending") {
    return phaseLabels[message.statusPhase ?? "submitting"] ?? "Sending";
  }
  if (message.status === "streaming") {
    return phaseLabels[message.statusPhase ?? "streaming"] ?? "Receiving reply";
  }
  if (message.status === "failed") {
    if (message.failureOrigin === "auth" || message.errorCode === "auth_required") {
      return "Sign-in required";
    }
    if (message.failureOrigin === "external") return "Provider unavailable";
    if (message.failureOrigin === "cancelled") return "Cancelled";
    if (message.failureOrigin === "client") return "AIHub interaction failed";
    return phaseLabels[message.statusPhase ?? "failed"] ?? "Failed";
  }
  return undefined;
}

export function messageStatusDetail(message: Pick<
  NormalizedMessage,
  "status" | "statusPhase" | "statusDetail" | "errorCode" | "failureOrigin"
>): string | undefined {
  if (message.statusPhase === "recoverable-blocked") {
    return message.statusDetail ?? "Open the provider page and submit the prepared prompt.";
  }
  if (message.status !== "failed" && message.status !== "pending") return undefined;
  if (!message.statusDetail) return undefined;
  if (message.failureOrigin === "auth" || message.errorCode === "auth_required") {
    return "Open the provider drawer and complete sign-in.";
  }
  return message.statusDetail;
}
