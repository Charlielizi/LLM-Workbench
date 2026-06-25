import { Copy, Edit3, RotateCcw, Trash2 } from "lucide-react";
import type { NormalizedMessage } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useToastStore } from "../../stores/toast-store";
import { messageText } from "../../utils/message-text";

export function MessageActions({
  message,
  canRetry,
  onEdit,
  onRetry,
}: {
  message: NormalizedMessage;
  canRetry: boolean;
  onEdit: () => void;
  onRetry: () => void;
}) {
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const addToast = useToastStore((state) => state.addToast);
  const locked =
    message.status === "pending" || message.status === "streaming";

  async function copy() {
    await navigator.clipboard.writeText(messageText(message));
    addToast("消息已复制", "success");
  }

  async function remove() {
    if (!window.confirm("确定删除这条消息吗？")) return;
    await deleteMessage(message.conversationId, message.id);
  }

  return (
    <div className="absolute -bottom-3 right-3 flex translate-y-1 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 focus-within:opacity-100">
      <ActionButton label="复制" icon={Copy} onClick={() => void copy()} />
      {message.role === "assistant" && canRetry && (
        <ActionButton
          label="重试"
          icon={RotateCcw}
          disabled={locked}
          onClick={onRetry}
        />
      )}
      {message.role === "user" && (
        <ActionButton
          label="编辑重发"
          icon={Edit3}
          disabled={locked}
          onClick={onEdit}
        />
      )}
      <ActionButton
        label="删除"
        icon={Trash2}
        disabled={locked}
        danger
        onClick={() => void remove()}
      />
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  icon: typeof Copy;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`grid size-7 place-items-center rounded-md ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      } disabled:cursor-not-allowed disabled:opacity-30`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} />
    </button>
  );
}
