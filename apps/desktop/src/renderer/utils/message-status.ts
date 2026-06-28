import type { NormalizedMessage, ProviderSendPhase } from "@aihub/core";

const phaseLabels: Partial<Record<ProviderSendPhase, string>> = {
  "checking-auth": "Checking sign-in",
  "configuring-model": "Selecting model",
  "configuring-modes": "Configuring tools",
  "preparing-attachments": "Preparing attachments",
  "uploading-attachments": "Uploading attachments",
  "typing-message": "Typing message",
  "submitting": "Submitting",
  "waiting-first-token": "Waiting for reply",
  "streaming": "Receiving reply",
  "completed": "Completed",
  "failed": "Failed",
};

export function messageStatusLabel(message: Pick<
  NormalizedMessage,
  "status" | "statusPhase" | "errorCode"
>): string | undefined {
  if (message.status === "pending") {
    return phaseLabels[message.statusPhase ?? "submitting"] ?? "Sending";
  }
  if (message.status === "streaming") {
    return phaseLabels[message.statusPhase ?? "streaming"] ?? "Receiving reply";
  }
  if (message.status === "failed") {
    if (message.errorCode === "auth_required") {
      return "Sign-in required";
    }
    return phaseLabels[message.statusPhase ?? "failed"] ?? "Failed";
  }
  return undefined;
}

export function messageStatusDetail(message: Pick<
  NormalizedMessage,
  "status" | "statusDetail" | "errorCode"
>): string | undefined {
  if (message.status !== "failed" && message.status !== "pending") {
    return undefined;
  }
  if (!message.statusDetail) return undefined;
  if (message.errorCode === "auth_required") {
    return "Open the provider drawer and complete sign-in.";
  }
  return message.statusDetail;
}
