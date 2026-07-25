import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { Toast, ToastType } from "../../stores/toast-store";
import { useToastStore } from "../../stores/toast-store";
import { useI18n } from "../../i18n";

const ICONS: Record<ToastType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  error: AlertCircle,
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  return (
    <div
      data-testid="toast-viewport"
      className="fixed bottom-5 right-5 z-40 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const Icon = ICONS[toast.type];
  return (
    <div
      data-testid="toast"
      data-toast-type={toast.type}
      className="flex items-start gap-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-3 shadow-xl"
    >
      <Icon
        size={18}
        className={
          toast.type === "error"
            ? "text-[var(--color-danger)]"
            : toast.type === "warning"
              ? "text-[var(--color-warning)]"
              : "text-[var(--color-accent)]"
        }
      />
      <p className="m-0 flex-1 text-sm leading-5">{toast.message}</p>
      <button
        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
        onClick={onDismiss}
        aria-label={t("toast.dismiss")}
        title={t("toast.dismiss")}
      >
        <X size={15} />
      </button>
    </div>
  );
}
