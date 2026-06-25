import { useEffect, useRef } from "react";
import type { ComponentType, ReactNode } from "react";

export function ContextMenu({
  position,
  onClose,
  children,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const left = Math.min(position.x, window.innerWidth - 230);
  const top = Math.min(position.y, window.innerHeight - 330);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1.5 shadow-2xl"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function ContextMenuItem({
  icon: Icon,
  label,
  hint,
  disabled = false,
  danger = false,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
          : "hover:bg-[var(--color-bg-hover)]"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {hint}
        </span>
      )}
    </button>
  );
}
