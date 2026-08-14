import { useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  Columns3,
  LogIn,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { createPortal } from "react-dom";
import { PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId, ProviderSummary } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useI18n } from "../../i18n";
import { usePaneLayoutStore } from "../../stores/pane-layout-store";
import { Logo } from "../brand/Logo";

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

export function MenuBar() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.snapshot.providers);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setComparisonSetupOpen = useAppStore((s) => s.setComparisonSetupOpen);
  const openSettings = useAppStore((s) => s.openSettings);
  const setShortcutHelpOpen = useAppStore((s) => s.setShortcutHelpOpen);
  const createConversation = useAppStore((s) => s.createConversation);
  const providerOrder = useSettingsStore((state) => state.providerOrder);
  const enabledProviders = useSettingsStore((state) => state.enabledProviders);
  const defaultProvider = useSettingsStore(
    (state) => state.defaultProvider ?? state.enabledProviders[0] ?? "chatgpt",
  );
  const visibleProviders = providerOrder.filter((provider) =>
    enabledProviders.includes(provider),
  );

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!menuBarRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [openMenu]);

  const toggleTheme = () =>
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    );

  const menus: Record<string, MenuItem[]> = {
    file: [
      {
        label: t("nav.newChat"),
        action: () => void createConversation(defaultProvider),
      },
      { separator: true, label: "" },
      {
        label: t("nav.compare"),
        action: () => setComparisonSetupOpen(true),
      },
    ],
    edit: [
      {
        label: t("settings.conversations"),
        shortcut: "Ctrl+F",
        action: () => document.getElementById("conversation-search")?.focus(),
      },
    ],
    view: [
      ...visibleProviders.map((id) => {
        const p = providers.find((pp) => pp.id === id);
        return {
          label: `${p?.websiteVisible ? t("provider.hide") : t("provider.show")} ${PROVIDER_LABELS[id]}`,
          action: () =>
            void window.aihub.setProviderWebsiteVisible(
              id,
              !p?.websiteVisible,
            ),
        };
      }),
      { separator: true, label: "" },
      {
        label:
          theme === "dark"
            ? t("settings.theme.light")
            : t("settings.theme.dark"),
        action: toggleTheme,
      },
    ],
    help: [
      {
        label: t("nav.shortcuts"),
        shortcut: "Ctrl+/",
        action: () => setShortcutHelpOpen(true),
      },
      { separator: true, label: "" },
      { label: t("nav.settings"), action: () => openSettings() },
    ],
  };

  const menuLabels: { key: string; label: string }[] = [
    { key: "file", label: t("nav.file") },
    { key: "edit", label: t("nav.edit") },
    { key: "view", label: t("nav.view") },
    { key: "help", label: t("nav.help") },
  ];

  return (
    <div
      ref={menuBarRef}
      className="flex h-full items-center px-1 [app-region:drag]"
    >
      <div className="flex items-center [app-region:no-drag]">
        {menuLabels.map(({ key, label }) => (
          <div key={key} className="relative">
            <button
              className={`rounded-md px-2.5 py-1 text-[12px] transition hover:bg-[var(--color-bg-hover)] ${
                openMenu === key
                  ? "bg-[var(--color-bg-hover)]"
                  : "text-[var(--color-text-secondary)]"
              }`}
              onMouseDown={() => setOpenMenu(openMenu === key ? null : key)}
              onMouseEnter={() => {
                if (openMenu && openMenu !== key) setOpenMenu(key);
              }}
            >
              {label}
            </button>
            {openMenu === key &&
              createPortal(
                <MenuBarDropdown
                  items={menus[key] ?? []}
                  onClose={() => setOpenMenu(null)}
                  menuKey={key}
                  menuLabels={menuLabels}
                />,
                document.body,
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopBar() {
  const { t } = useI18n();
  const providers = useAppStore((state) => state.snapshot.providers);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setComparisonSetupOpen = useAppStore(
    (state) => state.setComparisonSetupOpen,
  );
  const providerOrder = useSettingsStore((state) => state.providerOrder);
  const enabledProviders = useSettingsStore((state) => state.enabledProviders);
  const visibleProviders = providerOrder.filter((provider) =>
    enabledProviders.includes(provider),
  );
  const clientRequested = usePaneLayoutStore(
    (state) => state.clientRequested,
  );
  const providerRequested = usePaneLayoutStore(
    (state) => state.providerRequested,
  );
  const activeNarrowPane = usePaneLayoutStore(
    (state) => state.activeNarrowPane,
  );
  const narrowLayout = usePaneLayoutStore((state) => state.narrowLayout);
  const lastProviderId = usePaneLayoutStore(
    (state) => state.lastProviderId,
  );
  const showClient = usePaneLayoutStore((state) => state.showClient);
  const hideClient = usePaneLayoutStore((state) => state.hideClient);
  const showLastProvider = usePaneLayoutStore(
    (state) => state.showLastProvider,
  );
  const hideProvider = usePaneLayoutStore((state) => state.hideProvider);
  const setActiveNarrowPane = usePaneLayoutStore(
    (state) => state.setActiveNarrowPane,
  );

  return (
    <header className="panel-glass flex h-full items-center justify-between gap-3 px-4 [app-region:drag]">
      <div className="flex min-w-fit items-center gap-2">
        <Logo color={theme === "dark" ? "white" : "primary"} size={25} />
        {narrowLayout && clientRequested && providerRequested && (
          <div
            className="flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-0.5 [app-region:no-drag]"
            aria-label={t("layout.narrowSwitcher")}
          >
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                activeNarrowPane === "client"
                  ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--color-text-tertiary)]"
              }`}
              aria-pressed={activeNarrowPane === "client"}
              onClick={() => setActiveNarrowPane("client")}
            >
              LLM Workbench
            </button>
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                activeNarrowPane === "provider"
                  ? "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--color-text-tertiary)]"
              }`}
              aria-pressed={activeNarrowPane === "provider"}
              onClick={() => setActiveNarrowPane("provider")}
            >
              {lastProviderId
                ? PROVIDER_LABELS[lastProviderId]
                : t("layout.providerPane")}
            </button>
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 overflow-x-auto [app-region:no-drag]">
        <button
          data-testid="open-comparison"
          className="interactive-chip flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => setComparisonSetupOpen(true)}
        >
          <Columns3 size={13} />
          {t("top.compare")}
        </button>
        <div className="flex items-center gap-1">
          {visibleProviders.map((id) => (
            <ProviderDot
              key={id}
              id={id}
              provider={providers.find((item) => item.id === id)}
            />
          ))}
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-0.5"
          aria-label={t("layout.visibility")}
        >
          <button
            type="button"
            className="interactive-chip grid size-7 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={
              clientRequested ? t("layout.hideClient") : t("layout.showClient")
            }
            title={
              clientRequested ? t("layout.hideClient") : t("layout.showClient")
            }
            aria-pressed={clientRequested}
            disabled={clientRequested && !providerRequested}
            onClick={clientRequested ? hideClient : showClient}
          >
            {clientRequested ? (
              <PanelLeftClose size={14} />
            ) : (
              <PanelLeftOpen size={14} />
            )}
          </button>
          <button
            type="button"
            className="interactive-chip grid size-7 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={
              providerRequested
                ? t("layout.hideProvider")
                : t("layout.showProvider")
            }
            title={
              providerRequested
                ? t("layout.hideProvider")
                : t("layout.showProvider")
            }
            aria-pressed={providerRequested}
            disabled={!providerRequested && !lastProviderId}
            onClick={providerRequested ? hideProvider : showLastProvider}
          >
            {providerRequested ? (
              <PanelRightClose size={14} />
            ) : (
              <PanelRightOpen size={14} />
            )}
          </button>
        </div>
        <button
          className="interactive-chip rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() =>
            setTheme(
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark",
            )
          }
          aria-label={t("top.toggleTheme")}
          title={t("top.toggleTheme")}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}

function MenuBarDropdown({
  items,
  onClose,
  menuKey,
  menuLabels,
}: {
  items: MenuItem[];
  onClose: () => void;
  menuKey: string;
  menuLabels: { key: string; label: string }[];
}) {
  const idx = menuLabels.findIndex((m) => m.key === menuKey);
  const buttons = document.querySelectorAll(
    "[app-region='no-drag'] > div > button",
  );
  const btn = buttons[idx] as HTMLElement | undefined;
  const rect = btn?.getBoundingClientRect();

  const style: React.CSSProperties = rect
    ? { position: "fixed", top: rect.bottom, left: rect.left }
    : { position: "fixed", top: 32, left: 16 };

  return (
    <div
      className="z-50 min-w-[180px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-1 shadow-2xl"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-[var(--color-border)]" />
        ) : (
          <button
            key={i}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={() => {
              item.action?.();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="ml-4 text-[10px] text-[var(--color-text-tertiary)]">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

function ProviderDot({
  provider,
  id,
}: {
  provider: ProviderSummary | undefined;
  id: ProviderId;
}) {
  const { t } = useI18n();
  const label = PROVIDER_LABELS[id];
  const hasRecentFailure = Boolean(provider?.lastFailurePhase) && !provider?.degraded;
  const status = provider?.degraded
    ? t("provider.status.degraded")
    : !provider?.authenticated
      ? t("provider.status.login")
      : provider.ready
        ? t("provider.status.online")
        : t("provider.status.unavailable");
  const drawer = provider?.websiteVisible
    ? t("provider.drawer.open")
    : t("provider.drawer.closed");
  const diagnostic = [
    provider?.lastFailurePhase ? `phase=${provider.lastFailurePhase}` : undefined,
    provider?.lastFailureCode ? `code=${provider.lastFailureCode}` : undefined,
    provider?.lastFailureOrigin ? `origin=${provider.lastFailureOrigin}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const title = `${label} · ${status} · ${drawer}${
    diagnostic ? ` · ${diagnostic}` : ""
  }`;
  const StatusIcon =
    provider?.degraded || (!provider?.ready && provider?.authenticated)
      ? TriangleAlert
      : !provider?.authenticated
        ? LogIn
        : hasRecentFailure
          ? TriangleAlert
          : CircleCheck;
  return (
    <button
      className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      title={title}
      aria-label={title}
      aria-pressed={provider?.websiteVisible ?? false}
      onClick={() =>
        void window.aihub.setProviderWebsiteVisible(
          id,
          !provider?.websiteVisible,
        )
      }
    >
      <StatusIcon
        size={11}
        aria-hidden
        className={
          provider?.degraded
            ? "text-[var(--color-danger)]"
            : hasRecentFailure ||
                (!provider?.ready && provider?.authenticated)
              ? "text-[var(--color-warning)]"
              : provider?.authenticated
                ? "text-[var(--color-online)]"
                : "text-[var(--color-offline)]"
        }
      />
      <span className="leading-none">{label}</span>
    </button>
  );
}
