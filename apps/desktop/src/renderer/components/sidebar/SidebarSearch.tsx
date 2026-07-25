import { Search, X } from "lucide-react";
import { useI18n } from "../../i18n";

export function SidebarSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--color-border-strong)]">
      <Search size={15} className="text-[var(--color-text-tertiary)]" />
      <input
        data-testid="conversation-search"
        id="conversation-search"
        className="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-text-tertiary)]"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("search.placeholder")}
      />
      {query && (
        <button
          className="rounded-lg p-1 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => onChange("")}
          aria-label={t("search.clear")}
          title={t("search.clear")}
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}
