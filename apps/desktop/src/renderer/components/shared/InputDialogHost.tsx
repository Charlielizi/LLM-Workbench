import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useDialogStore } from "../../stores/dialog-store";
import { Dialog } from "./Dialog";

export function InputDialogHost() {
  const { t } = useI18n();
  const request = useDialogStore((state) => state.inputRequest);
  const finish = useDialogStore((state) => state.finishInput);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (request) setValue(request.initialValue ?? "");
  }, [request]);

  return (
    <Dialog
      open={Boolean(request)}
      onClose={() => finish(undefined)}
      title={request?.title ?? ""}
      description={request?.description}
      widthClass="w-[min(480px,calc(100vw-48px))]"
      closeOnBackdrop
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          finish(value.trim());
        }}
      >
        <input
          autoFocus
          className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
          value={value}
          placeholder={request?.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
            onClick={() => finish(undefined)}
          >
            {request?.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-send-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-send-text)] disabled:opacity-40"
            disabled={!request?.allowEmpty && !value.trim()}
          >
            {request?.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
