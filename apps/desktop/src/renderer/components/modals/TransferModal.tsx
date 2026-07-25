import { PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import { Dialog } from "../shared/Dialog";

export function TransferModal() {
  const { t } = useI18n();
  const transfer = useAppStore((state) => state.transfer);
  const busy = useAppStore((state) => state.busy);
  const conversations = useAppStore(
    (state) => state.snapshot.conversations,
  );
  const setTransfer = useAppStore((state) => state.setTransfer);
  const openTransferPreview = useAppStore(
    (state) => state.openTransferPreview,
  );
  const confirmTransfer = useAppStore((state) => state.confirmTransfer);
  const enabledProviders = useSettingsStore(
    (state) => state.enabledProviders,
  );
  const providerOrder = useSettingsStore((state) => state.providerOrder);

  const source = conversations.find(
    (conversation) => conversation.id === transfer?.sourceConversationId,
  );
  const targets = providerOrder.filter(
    (provider) =>
      enabledProviders.includes(provider) && provider !== source?.provider,
  );

  return (
    <Dialog
      open={Boolean(transfer)}
      onClose={() => setTransfer(undefined)}
      title={t("transfer.title")}
      description={t("transfer.description")}
      widthClass="w-[min(820px,calc(100vw-64px))]"
    >
      {transfer && (
        <div
          data-testid="transfer-modal"
          className="grid h-[min(580px,calc(100vh-200px))] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]"
        >
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1.5 block text-xs text-[var(--color-text-secondary)]">
                {t("transfer.targetProvider")}
              </span>
              <select
                className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
                value={transfer.targetProvider}
                onChange={(event) =>
                  void openTransferPreview(
                    event.target.value as ProviderId,
                    transfer.compressionProvider,
                  )
                }
              >
                {targets.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-xs text-[var(--color-text-secondary)]">
                {t("transfer.compressionProvider")}
              </span>
              <select
                className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
                value={transfer.compressionProvider ?? ""}
                onChange={(event) =>
                  setTransfer({
                    ...transfer,
                    compressionProvider:
                      (event.target.value as ProviderId) || undefined,
                  })
                }
              >
                <option value="">{t("transfer.skipCompression")}</option>
                {providerOrder
                  .filter((provider) => enabledProviders.includes(provider))
                  .map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className="my-4 rounded-xl bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
            {t("transfer.warning", {
              provider: PROVIDER_LABELS[transfer.targetProvider],
              count: transfer.messageCount,
            })}
          </p>
          <textarea
            className="min-h-0 w-full resize-none rounded-xl border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] p-4 font-mono text-sm leading-6 outline-none focus:border-[var(--color-accent)]"
            value={transfer.markdown}
            onChange={(event) =>
              setTransfer({ ...transfer, markdown: event.target.value })
            }
          />
          <footer className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              className="rounded-lg px-4 py-2 hover:bg-[var(--color-bg-hover)]"
              onClick={() => setTransfer(undefined)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 font-semibold text-[#08100c] disabled:opacity-50"
              disabled={busy || targets.length === 0}
              onClick={() => void confirmTransfer()}
            >
              {busy ? t("transfer.busy") : t("transfer.confirm")}
            </button>
          </footer>
        </div>
      )}
    </Dialog>
  );
}
