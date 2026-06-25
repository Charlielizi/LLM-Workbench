import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";

export type ProviderFilter = ProviderId | "all";

export function ProviderFilterTabs({
  value,
  onChange,
}: {
  value: ProviderFilter;
  onChange: (value: ProviderFilter) => void;
}) {
  return (
    <div className="mb-2 flex gap-1 overflow-x-auto px-3 pb-1">
      <FilterButton
        active={value === "all"}
        label="全部"
        onClick={() => onChange("all")}
      />
      {PROVIDER_IDS.map((provider) => (
        <FilterButton
          key={provider}
          active={value === provider}
          label={PROVIDER_LABELS[provider]}
          onClick={() => onChange(provider)}
        />
      ))}
    </div>
  );
}

function FilterButton({
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
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
        active
          ? "bg-[var(--color-accent-bg)] font-semibold text-[#08100c]"
          : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
