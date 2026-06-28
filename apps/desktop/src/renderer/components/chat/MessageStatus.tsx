import { AlertCircle, Clock3, RotateCcw } from "lucide-react";
import type { NormalizedMessage } from "@aihub/core";
import {
  messageStatusDetail,
  messageStatusLabel,
} from "../../utils/message-status";

export function MessageStatus({
  message,
  onRetry,
}: {
  message: Pick<
    NormalizedMessage,
    "status" | "statusPhase" | "statusDetail" | "errorCode"
  >;
  onRetry: () => Promise<void>;
}) {
  const label = messageStatusLabel(message);
  const detail = messageStatusDetail(message);

  if (message.status === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1 font-normal text-[var(--color-warning)]"
        title={detail}
      >
        <Clock3 size={13} />
        {label ?? "Sending"}
      </span>
    );
  }
  if (message.status === "streaming") {
    return (
      <span className="inline-flex items-center gap-1 font-normal text-[var(--color-text-secondary)]">
        <i className="size-2 animate-pulse rounded-full bg-current" />
        {label ?? "Receiving reply"}
      </span>
    );
  }
  if (message.status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 font-normal text-[var(--color-danger)]"
        title={detail}
      >
        <AlertCircle size={13} />
        {label ?? "Failed"}
        <button
          className="ml-1 rounded p-1 hover:bg-[var(--color-danger-bg)]"
          onClick={() => void onRetry()}
          title="Retry"
        >
          <RotateCcw size={12} />
        </button>
      </span>
    );
  }
  return null;
}
