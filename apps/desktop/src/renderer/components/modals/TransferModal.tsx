import { X } from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";

export function TransferModal() {
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

  if (!transfer) return null;
  const source = conversations.find(
    (conversation) => conversation.id === transfer.sourceConversationId,
  );
  const targets = PROVIDER_IDS.filter(
    (provider) => provider !== source?.provider,
  );

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[#06080dbd] p-8 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setTransfer(undefined);
      }}
    >
      <section className="grid h-[min(720px,calc(100vh-64px))] w-[min(820px,calc(100vw-64px))] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-tertiary)] p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              跨 Provider 迁移
            </span>
            <h2 className="mt-1 text-xl font-semibold">迁移上下文预览</h2>
          </div>
          <button
            className="rounded-lg p-2 hover:bg-[var(--color-bg-hover)]"
            onClick={() => setTransfer(undefined)}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1.5 block text-xs text-[var(--color-text-secondary)]">
              目标 Provider
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
              压缩 Provider
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
              <option value="">跳过压缩</option>
              {PROVIDER_IDS.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="my-4 rounded-xl bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
          将向 {PROVIDER_LABELS[transfer.targetProvider]} 发送这段会话的{" "}
          {transfer.messageCount} 条消息摘要。请删除不希望跨平台发送的内容。
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
            className="rounded-lg px-4 py-2 hover:bg-[var(--color-bg-hover)]"
            onClick={() => setTransfer(undefined)}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-[var(--color-accent-bg)] px-4 py-2 font-semibold text-[#08100c] disabled:opacity-50"
            disabled={busy}
            onClick={() => void confirmTransfer()}
          >
            {busy ? "迁移中…" : "确认并迁移"}
          </button>
        </footer>
      </section>
    </div>
  );
}
