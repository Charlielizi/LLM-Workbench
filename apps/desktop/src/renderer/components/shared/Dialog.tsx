import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import { useDialogStore } from "../../stores/dialog-store";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  widthClass = "w-[min(720px,calc(100vw-48px))]",
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  widthClass?: string;
  closeOnBackdrop?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const registerModal = useDialogStore((state) => state.registerModal);
  const unregisterModal = useDialogStore((state) => state.unregisterModal);

  useEffect(() => {
    if (!open) return;
    registerModal();
    return unregisterModal;
  }, [open, registerModal, unregisterModal]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      const focusable = focusableElements(panelRef.current)[0];
      (focusable ?? panelRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusableElements(panelRef.current);
    if (elements.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = elements[0]!;
    const last = elements.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#06080dbd] p-6 backdrop-blur-md"
      onMouseDown={(event) => {
        if (
          closeOnBackdrop &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`${widthClass} max-h-[calc(100vh-48px)] overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl`}
        onKeyDown={handleKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 id={titleId} className="font-semibold">
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-sm text-[var(--color-text-secondary)]"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-[var(--color-bg-hover)]"
            onClick={onClose}
            aria-label={t("dialog.close")}
            title={t("dialog.close")}
          >
            <X size={17} />
          </button>
        </header>
        <div className="max-h-[calc(100vh-150px)] overflow-y-auto p-5">
          {children}
        </div>
      </section>
    </div>
  );
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });
}
