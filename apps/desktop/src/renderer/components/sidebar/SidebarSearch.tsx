import { Search, X } from "lucide-react";

export function SidebarSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  return (
    <label className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-3 focus-within:border-[var(--color-accent)]">
      <Search size={15} className="text-[var(--color-text-tertiary)]" />
      <input
        id="conversation-search"
        className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm outline-none placeholder:text-[var(--color-text-tertiary)]"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索会话和消息"
      />
      {query && (
        <button
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          onClick={() => onChange("")}
          aria-label="清除搜索"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}
