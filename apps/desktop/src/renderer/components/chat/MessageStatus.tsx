import { AlertCircle, Clock3, RotateCcw } from "lucide-react";
import type { MessageStatus as Status } from "@aihub/core";

export function MessageStatus({
  status,
  onRetry,
}: {
  status: Status;
  onRetry: () => Promise<void>;
}) {
  if (status === "pending") {
    return (
      <span className="flex items-center gap-1 font-normal text-[var(--color-warning)]">
        <Clock3 size={13} />
        发送中
      </span>
    );
  }
  if (status === "streaming") {
    return (
      <span className="flex items-center gap-1 font-normal text-[var(--color-accent)]">
        <i className="size-2 animate-pulse rounded-full bg-current" />
        生成中
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 font-normal text-[var(--color-danger)]">
        <AlertCircle size={13} />
        已中断
        <button
          className="ml-1 rounded p-1 hover:bg-[var(--color-danger-bg)]"
          onClick={() => void onRetry()}
          title="重试"
        >
          <RotateCcw size={12} />
        </button>
      </span>
    );
  }
  return null;
}
