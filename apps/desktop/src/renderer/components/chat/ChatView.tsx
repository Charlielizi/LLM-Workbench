import {
  ArrowRightLeft,
  Settings2,
  SplitSquareHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
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
  const setComparisonSetupOpen = useAppStore(
    (state) => state.setComparisonSetupOpen,
  );
  const setSettingsModalOpen = useAppStore(
    (state) => state.setSettingsModalOpen,
  );

  if (!selected) return <WelcomeView />;

  return (
    <main className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="panel-glass sticky top-0 z-10 px-5 pb-3 pt-4">
        <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between gap-4 rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 shadow-[var(--shadow-sm)]">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
                {PROVIDER_LABELS[selected.provider]}
              </span>
              <div className="hidden items-center gap-1 md:flex">
                {providerDefinitions[selected.provider].capabilities
                  .slice(0, 3)
                  .map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-[var(--color-bg-soft)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
                    >
                      {capability}
                    </span>
                  ))}
              </div>
            </div>
            <h1 className="truncate text-sm font-medium md:text-base">
              {selected.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <HeaderIconButton
              title="Transfer conversation"
              onClick={() => void openTransferPreview()}
            >
              <ArrowRightLeft size={15} />
            </HeaderIconButton>
            <HeaderIconButton
              title="Compare"
              onClick={() => setComparisonSetupOpen(true)}
            >
              <SplitSquareHorizontal size={15} />
            </HeaderIconButton>
            <HeaderIconButton
              title="Settings"
              onClick={() => setSettingsModalOpen(true)}
            >
              <Settings2 size={15} />
            </HeaderIconButton>
          </div>
        </div>
        {providerState && !providerState.authenticated && (
          <div className="mx-auto mt-2 flex w-full max-w-[1040px] items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
            <span className="truncate">
              {PROVIDER_LABELS[selected.provider]} login required before sending.
            </span>
            <button
              className="interactive-chip shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-glass-strong)] px-3 py-1 text-[var(--color-text-primary)]"
              onClick={() =>
                void window.aihub.setProviderWebsiteVisible(
                  selected.provider,
                  true,
                )
              }
            >
              Open
            </button>
          </div>
        )}
      </header>
      <MessageList conversation={selected} />
      <Composer conversation={selected} />
    </main>
  );
}

function HeaderIconButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="interactive-chip grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
