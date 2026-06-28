import { Search, X } from "lucide-react";

export function SidebarSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  return (
    <label className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--color-border-strong)]">
      <Search size={15} className="text-[var(--color-text-tertiary)]" />
      <input
        id="conversation-search"
        className="min-w-0 flex-1 border-0 bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-text-tertiary)]"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search conversations"
      />
      {query && (
        <button
          className="rounded-lg p-1 text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}
