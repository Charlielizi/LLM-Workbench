import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useI18n } from "../../i18n";

export type ProviderFilter = ProviderId | "all";

export function ProviderFilterTabs({
  value,
  onChange,
}: {
  value: ProviderFilter;
  onChange: (value: ProviderFilter) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (
        menuRef.current?.contains(event.target as Node) ||
        buttonRef.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [open]);

  const label = value === "all" ? t("nav.allProviders") : PROVIDER_LABELS[value];

  return (
    <>
      <button
        ref={buttonRef}
        className="interactive-chip flex w-full items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={13} />
      </button>
      {open &&
        createPortal(
          <FilterDropdown
            ref={menuRef}
            value={value}
            allLabel={t("nav.allProviders")}
            anchor={buttonRef.current}
            onSelect={(v) => {
              onChange(v);
              setOpen(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}

const FilterDropdown = ({
  ref,
  value,
  anchor,
  onSelect,
  allLabel,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  value: ProviderFilter;
  anchor: HTMLButtonElement | null;
  onSelect: (v: ProviderFilter) => void;
  allLabel: string;
}) => {
  const rect = anchor?.getBoundingClientRect();
  const style: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      }
    : { position: "fixed", top: 200, left: 16 };

  return (
    <div
      ref={ref}
      className="z-50 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-2xl"
      style={style}
    >
      <FilterItem
        active={value === "all"}
        label={allLabel}
        onClick={() => onSelect("all")}
      />
      {PROVIDER_IDS.map((id) => (
        <FilterItem
          key={id}
          active={value === id}
          label={PROVIDER_LABELS[id]}
          onClick={() => onSelect(id)}
        />
      ))}
    </div>
  );
};

function FilterItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs ${
        active
          ? "bg-[var(--color-bg-hover)] font-medium text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
