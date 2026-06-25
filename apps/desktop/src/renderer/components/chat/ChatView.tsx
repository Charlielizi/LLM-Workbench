import { ArrowRightLeft } from "lucide-react";
import { providerDefinitions } from "@aihub/adapters";
import { PROVIDER_LABELS } from "@aihub/core";
import { useAppStore, useSelectedConversation } from "../../stores/app-store";
import { Composer } from "../composer/Composer";
import { WelcomeView } from "../welcome/WelcomeView";
import { MessageList } from "./MessageList";

export function ChatView() {
  const selected = useSelectedConversation();
  const openTransferPreview = useAppStore(
    (state) => state.openTransferPreview,
  );
  const providerState = useAppStore((state) =>
    state.snapshot.providers.find(
      (provider) => provider.id === selected?.provider,
    ),
  );

  if (!selected) return <WelcomeView />;

  return (
    <main className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="px-7 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2.5 py-1 text-[11px] font-bold text-[#08100c]">
              {PROVIDER_LABELS[selected.provider]}
            </span>
            <h1 className="truncate text-base font-semibold">
              {selected.title}
            </h1>
            <div className="hidden items-center gap-1 xl:flex">
              {providerDefinitions[selected.provider].capabilities.map(
                (capability) => (
                  <span
                    key={capability}
                    className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
                  >
                    {capability}
                  </span>
                ),
              )}
            </div>
          </div>
          <button
            className="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
            onClick={() => void openTransferPreview()}
          >
            <ArrowRightLeft size={15} />
            迁移会话
          </button>
        </div>
        {providerState && !providerState.authenticated && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-4 py-2.5 text-sm text-[var(--color-warning)]">
            <span>
              {PROVIDER_LABELS[selected.provider]} 尚未登录，发送消息前请先完成登录。
            </span>
            <button
              className="shrink-0 rounded-lg border border-current px-3 py-1.5 font-medium hover:bg-[var(--color-bg-hover)]"
              onClick={() =>
                void window.aihub.setProviderWebsiteVisible(
                  selected.provider,
                  true,
                )
              }
            >
              打开登录页
            </button>
          </div>
        )}
      </header>
      <MessageList conversation={selected} />
      <Composer conversation={selected} />
    </main>
  );
}
