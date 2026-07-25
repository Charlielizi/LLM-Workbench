import {
  ArrowRightLeft,
  CornerDownLeft,
  Eye,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  SplitSquareHorizontal,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { providerDefinitions } from "@aihub/adapters";
import { PROVIDER_LABELS } from "@aihub/core";
import { useAppStore, useSelectedConversation } from "../../stores/app-store";
import { useToastStore } from "../../stores/toast-store";
import { useI18n } from "../../i18n";
import { Composer } from "../composer/Composer";
import { WelcomeView } from "../welcome/WelcomeView";
import { MessageList } from "./MessageList";

export function ChatView() {
  const { t } = useI18n();
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
  const addToast = useToastStore((state) => state.addToast);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!selected) return <WelcomeView />;

  const handleRecover = () =>
    void window.aihub
      .recoverProvider(selected.provider)
      .then(() => addToast(t("common.success"), "success"))
      .catch((cause) => addToast(errorText(cause), "error"));

  const handleResync = () =>
    void window.aihub
      .syncLatestProviderResponse(selected.provider)
      .then((recovered) =>
        addToast(
          recovered ? t("common.success") : t("common.failed"),
          recovered ? "success" : "warning",
        ),
      )
      .catch((cause) => addToast(errorText(cause), "error"));

  const handleSubmit = () =>
    void window.aihub
      .submitProviderEnter(selected.provider)
      .then(() => addToast(t("common.success"), "success"))
      .catch((cause) => addToast(errorText(cause), "error"));

  return (
    <main
      data-testid="chat-view"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
    >
      <header className="panel-glass sticky top-0 z-10 px-5 pb-3 pt-4">
        <div className="mx-auto flex w-full max-w-[var(--content-max-width)] items-center justify-between gap-4 rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 shadow-[var(--shadow-sm)]">
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
              title={t("provider.open")}
              active={providerState?.websiteVisible}
              onClick={() =>
                void window.aihub.setProviderWebsiteVisible(
                  selected.provider,
                  !providerState?.websiteVisible,
                )
              }
            >
              <Eye size={15} />
            </HeaderIconButton>
            <HeaderIconButton
              title={t("provider.transfer")}
              onClick={() => void openTransferPreview()}
            >
              <ArrowRightLeft size={15} />
            </HeaderIconButton>
            <HeaderIconButton
              title={t("provider.compare")}
              onClick={() => setComparisonSetupOpen(true)}
            >
              <SplitSquareHorizontal size={15} />
            </HeaderIconButton>
            <div className="relative">
              <HeaderIconButton
                title={t("provider.more")}
                active={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal size={16} />
              </HeaderIconButton>
              {moreOpen && (
                <div
                  className="absolute right-0 top-11 z-30 w-56 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-2xl"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMoreOpen(false);
                  }}
                >
                  <MoreAction
                    icon={<CornerDownLeft size={14} />}
                    label={t("provider.submit")}
                    onClick={() => {
                      setMoreOpen(false);
                      handleSubmit();
                    }}
                  />
                  <MoreAction
                    icon={<RefreshCw size={14} />}
                    label={t("provider.resync")}
                    onClick={() => {
                      setMoreOpen(false);
                      handleResync();
                    }}
                  />
                  <MoreAction
                    icon={<RotateCcw size={14} />}
                    label={t("provider.recover")}
                    onClick={() => {
                      setMoreOpen(false);
                      handleRecover();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {providerState &&
          (!providerState.authenticated ||
            !providerState.ready ||
            providerState.degraded) && (
            <div className="mx-auto mt-2 flex w-full max-w-[var(--content-max-width)] items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
              <span className="min-w-0 flex-1 truncate">
                {providerState.reason ??
                  t("chat.loginRequired", {
                    provider: PROVIDER_LABELS[selected.provider],
                  })}
              </span>
              <div className="flex shrink-0 gap-1">
                <RecoveryButton
                  label={t("chat.openProvider")}
                  onClick={() =>
                    void window.aihub.setProviderWebsiteVisible(
                      selected.provider,
                      true,
                    )
                  }
                />
                <RecoveryButton
                  label={t("chat.retryRecovery")}
                  onClick={handleRecover}
                />
                <RecoveryButton
                  label={t("chat.resync")}
                  onClick={handleResync}
                />
              </div>
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
  active,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`interactive-chip grid size-9 place-items-center rounded-full border ${
        active
          ? "border-[var(--color-border-strong)] bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      }`}
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MoreAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function RecoveryButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="interactive-chip rounded-full border border-[var(--color-border)] bg-[var(--color-bg-glass-strong)] px-3 py-1 text-[var(--color-text-primary)]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
