import { useEffect, useRef, useState } from "react";
import { Columns3, Moon, Sun } from "lucide-react";
import { createPortal } from "react-dom";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId, ProviderSummary } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

export function MenuBar() {
  const providers = useAppStore((state) => state.snapshot.providers);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const setComparisonSetupOpen = useAppStore((s) => s.setComparisonSetupOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const setShortcutHelpOpen = useAppStore((s) => s.setShortcutHelpOpen);
  const createConversation = useAppStore((s) => s.createConversation);

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
        label: "新建对话",
        action: () => void createConversation("chatgpt"),
      },
      { separator: true, label: "" },
      {
        label: "Compare 对比",
        action: () => setComparisonSetupOpen(true),
      },
    ],
    edit: [
      {
        label: "搜索会话",
        shortcut: "Ctrl+F",
        action: () => document.getElementById("conversation-search")?.focus(),
      },
    ],
    view: [
      ...PROVIDER_IDS.map((id) => {
        const p = providers.find((pp) => pp.id === id);
        return {
          label: `${p?.websiteVisible ? "隐藏" : "显示"} ${PROVIDER_LABELS[id]}`,
          action: () =>
            void window.aihub.setProviderWebsiteVisible(
              id,
              !p?.websiteVisible,
            ),
        };
      }),
      { separator: true, label: "" },
      {
        label: theme === "dark" ? "浅色模式" : "深色模式",
        action: toggleTheme,
      },
    ],
    help: [
      {
        label: "快捷键",
        shortcut: "Ctrl+/",
        action: () => setShortcutHelpOpen(true),
      },
      { separator: true, label: "" },
      { label: "设置", action: () => setSettingsModalOpen(true) },
    ],
  };

  const menuLabels: { key: string; label: string }[] = [
    { key: "file", label: "文件" },
    { key: "edit", label: "编辑" },
    { key: "view", label: "视图" },
    { key: "help", label: "帮助" },
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
  const providers = useAppStore((state) => state.snapshot.providers);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setComparisonSetupOpen = useAppStore(
    (state) => state.setComparisonSetupOpen,
  );

  return (
    <header className="panel-glass flex h-full items-center justify-between gap-3 px-4 [app-region:drag]">
      <div className="flex min-w-fit items-center gap-2">
        <strong className="text-sm font-semibold tracking-tight">AIHub</strong>
      </div>

      <div className="flex min-w-0 items-center gap-2 overflow-x-auto [app-region:no-drag]">
        <button
          className="interactive-chip flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => setComparisonSetupOpen(true)}
        >
          <Columns3 size={13} />
          Compare
        </button>
        <div className="flex items-center gap-1">
          {PROVIDER_IDS.map((id) => (
            <ProviderDot
              key={id}
              id={id}
              provider={providers.find((item) => item.id === id)}
            />
          ))}
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
          aria-label="Toggle theme"
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
  const label = PROVIDER_LABELS[id];
  return (
    <button
      className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      title={
        provider?.degraded
          ? "degraded"
          : provider?.websiteVisible
            ? "visible"
            : provider?.authenticated
              ? "logged in"
              : "offline"
      }
      onClick={() =>
        void window.aihub.setProviderWebsiteVisible(
          id,
          !provider?.websiteVisible,
        )
      }
    >
      <i
        className="size-1.5 shrink-0 rounded-full transition-shadow"
        style={{
          background: provider?.degraded
            ? "var(--color-danger)"
            : provider?.authenticated
              ? "var(--color-online)"
              : "var(--color-offline)",
          boxShadow: provider?.websiteVisible
            ? "0 0 0 1.5px var(--color-bg-primary), 0 0 0 3px var(--color-text-primary)"
            : undefined,
        }}
      />
      <span className="leading-none">{label}</span>
    </button>
  );
}
