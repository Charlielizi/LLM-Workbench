import { useState } from "react";
import { Columns3 } from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useI18n } from "../../i18n";
import { Dialog } from "../shared/Dialog";

export function ComparisonSetupModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.comparisonSetupOpen);
  const busy = useAppStore((state) => state.busy);
  const setOpen = useAppStore((state) => state.setComparisonSetupOpen);
  const createComparison = useAppStore((state) => state.createComparison);
  const [providers, setProviders] = useState<ProviderId[]>([
    "chatgpt",
    "claude",
  ]);
  const providerOrder = useSettingsStore((state) => state.providerOrder);
  const enabledProviders = useSettingsStore((state) => state.enabledProviders);
  const availableProviders = providerOrder.filter((provider) =>
    enabledProviders.includes(provider),
  );

  function toggle(provider: ProviderId) {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : current.length < 4
          ? [...current, provider]
          : current,
    );
  }

  const selectedProviders = providers.filter((provider) =>
    enabledProviders.includes(provider),
  );

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={t("compare.title")}
      description={t("compare.description")}
      widthClass="w-[min(576px,calc(100vw-48px))]"
    >
      <div data-testid="comparison-modal">
        <div className="mb-5 grid grid-cols-2 gap-2">
          {availableProviders.map((provider) => {
            const selected = selectedProviders.includes(provider);
            return (
              <button
                key={provider}
                className={`rounded-xl border px-4 py-3 text-left ${
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                }`}
                aria-pressed={selected}
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
          data-testid="start-comparison"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-bg)] px-4 py-3 font-semibold text-[#08100c] disabled:opacity-40"
          disabled={busy || selectedProviders.length < 2}
          onClick={() => void createComparison(selectedProviders)}
        >
          <Columns3 size={17} />
          {busy ? t("compare.creating") : t("compare.start")}
        </button>
      </div>
    </Dialog>
  );
}
