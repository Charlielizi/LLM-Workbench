import { Copy, Edit3, RotateCcw, Trash2 } from "lucide-react";
import type { NormalizedMessage } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useToastStore } from "../../stores/toast-store";
import { messageText } from "../../utils/message-text";
import { confirmDialog } from "../../stores/dialog-store";
import { useI18n } from "../../i18n";

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
  const { t } = useI18n();
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const addToast = useToastStore((state) => state.addToast);
  const locked =
    message.status === "pending" || message.status === "streaming";

  async function copy() {
    await navigator.clipboard.writeText(messageText(message));
    addToast(t("message.copied"), "success");
  }

  async function remove() {
    const confirmed = await confirmDialog({
      title: t("message.deleteTitle"),
      description: t("message.deleteDescription"),
      destructive: true,
    });
    if (!confirmed) return;
    if (await deleteMessage(message.conversationId, message.id)) {
      addToast(t("toast.deleted"), "success");
    }
  }

  return (
    <div
      className={`mt-2 flex items-center gap-1 opacity-0 transition duration-150 group-hover:opacity-100 focus-within:opacity-100 ${
        message.role === "user" ? "justify-end pr-1" : "justify-start"
      }`}
    >
      <div className="panel-glass flex items-center gap-1 rounded-full border border-[var(--color-border)] p-1 shadow-[var(--shadow-sm)]">
        <ActionButton
          label={t("message.copy")}
          icon={Copy}
          onClick={() => void copy()}
        />
        {message.role === "assistant" && canRetry && (
          <ActionButton
            label={t("message.retry")}
            icon={RotateCcw}
            disabled={locked}
            onClick={onRetry}
          />
        )}
        {message.role === "user" && (
          <ActionButton
            label={t("message.edit")}
            icon={Edit3}
            disabled={locked}
            onClick={onEdit}
          />
        )}
        <ActionButton
          label={t("message.delete")}
          icon={Trash2}
          disabled={locked}
          danger
          onClick={() => void remove()}
        />
      </div>
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
      className={`interactive-chip grid size-8 place-items-center rounded-full ${
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
