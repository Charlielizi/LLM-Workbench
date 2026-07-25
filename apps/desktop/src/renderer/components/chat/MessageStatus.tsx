import { AlertCircle, Clock3, RotateCcw } from "lucide-react";
import type { NormalizedMessage } from "@aihub/core";
import { useI18n } from "../../i18n";

export function MessageStatus({
  message,
  onRetry,
}: {
  message: Pick<
    NormalizedMessage,
    "status" | "statusPhase" | "statusDetail" | "errorCode" | "failureOrigin"
  >;
  onRetry: () => Promise<void>;
}) {
  const { t } = useI18n();
  const actionRequired = message.statusPhase === "recoverable-blocked";
  const authRequired =
    message.errorCode === "auth_required" ||
    message.failureOrigin === "auth";
  const detail = actionRequired
    ? t("message.status.openToSubmit")
    : authRequired
      ? t("message.status.openToSignIn")
      : message.statusDetail;
  const failedLabel = authRequired
    ? t("message.status.signInRequired")
    : message.failureOrigin === "external"
      ? t("message.status.unavailable")
      : message.failureOrigin === "cancelled"
        ? t("message.status.cancelled")
        : message.failureOrigin === "client"
          ? t("message.status.interactionFailed")
          : t("message.status.failed");

  if (message.status === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1 font-normal text-[var(--color-warning)]"
        title={detail}
      >
        <Clock3 size={13} />
        {actionRequired
          ? t("message.status.actionRequired")
          : message.statusPhase === "checking-auth"
            ? t("message.status.checkingSignIn")
            : t("message.status.sending")}
      </span>
    );
  }
  if (message.status === "streaming") {
    return (
      <span className="inline-flex items-center gap-1 font-normal text-[var(--color-text-secondary)]">
        <i className="size-2 animate-pulse rounded-full bg-current" />
        {t("message.status.receiving")}
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
        {failedLabel}
        <button
          className="ml-1 rounded p-1 hover:bg-[var(--color-danger-bg)]"
          onClick={() => void onRetry()}
          title={t("common.retry")}
          aria-label={t("common.retry")}
        >
          <RotateCcw size={12} />
        </button>
      </span>
    );
  }
  return null;
}
