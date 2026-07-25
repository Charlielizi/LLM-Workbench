import { Dialog } from "./Dialog";
import { useDialogStore } from "../../stores/dialog-store";
import { useI18n } from "../../i18n";

export function ConfirmDialogHost() {
  const { t } = useI18n();
  const request = useDialogStore((state) => state.request);
  const finish = useDialogStore((state) => state.finish);
  return (
    <Dialog
      open={Boolean(request)}
      onClose={() => finish(false)}
      title={request?.title ?? ""}
      description={request?.description}
      widthClass="w-[min(480px,calc(100vw-48px))]"
      closeOnBackdrop
    >
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
          onClick={() => finish(false)}
        >
          {request?.cancelLabel ?? t("common.cancel")}
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            request?.destructive
              ? "bg-[var(--color-danger)] text-white"
              : "bg-[var(--color-send-bg)] text-[var(--color-send-text)]"
          }`}
          onClick={() => finish(true)}
        >
          {request?.confirmLabel ??
            (request?.destructive
              ? t("dialog.destructiveConfirm")
              : t("common.confirm"))}
        </button>
      </div>
    </Dialog>
  );
}
