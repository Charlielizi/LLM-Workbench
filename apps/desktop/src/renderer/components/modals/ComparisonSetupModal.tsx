import { useState } from "react";
import { Columns3, X } from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";

export function ComparisonSetupModal() {
  const open = useAppStore((state) => state.comparisonSetupOpen);
  const busy = useAppStore((state) => state.busy);
  const setOpen = useAppStore((state) => state.setComparisonSetupOpen);
  const createComparison = useAppStore((state) => state.createComparison);
  const [providers, setProviders] = useState<ProviderId[]>([
    "chatgpt",
    "claude",
  ]);

  if (!open) return null;

  function toggle(provider: ProviderId) {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : current.length < 4
          ? [...current, provider]
          : current,
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[#06080dbd] p-8 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section className="w-full max-w-xl rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-tertiary)] p-6 shadow-2xl">
        <header className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">多模型并行对比</h2>
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              选择 2–4 个 Provider，同时发送同一条消息。
            </p>
          </div>
          <button
            className="rounded-lg p-2 hover:bg-[var(--color-bg-hover)]"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="my-5 grid grid-cols-2 gap-2">
          {PROVIDER_IDS.map((provider) => {
            const selected = providers.includes(provider);
            return (
              <button
                key={provider}
                className={`rounded-xl border px-4 py-3 text-left ${
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                }`}
                onClick={() => toggle(provider)}
              >
                <span className="text-sm font-medium">
                  {PROVIDER_LABELS[provider]}
                </span>
              </button>
            );
          })}
        </div>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-bg)] px-4 py-3 font-semibold text-[#08100c] disabled:opacity-40"
          disabled={busy || providers.length < 2}
          onClick={() => void createComparison(providers)}
        >
          <Columns3 size={17} />
          {busy ? "正在创建…" : "开始对比"}
        </button>
      </section>
    </div>
  );
}
