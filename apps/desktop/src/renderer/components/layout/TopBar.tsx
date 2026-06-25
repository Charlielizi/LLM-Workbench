import {
  Columns3,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId, ProviderSummary } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";

export function TopBar() {
  const providers = useAppStore((state) => state.snapshot.providers);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const sidebarCollapsed = useSettingsStore(
    (state) => state.sidebarCollapsed,
  );
  const setSidebarCollapsed = useSettingsStore(
    (state) => state.setSidebarCollapsed,
  );
  const setComparisonSetupOpen = useAppStore(
    (state) => state.setComparisonSetupOpen,
  );
  const setSettingsModalOpen = useAppStore(
    (state) => state.setSettingsModalOpen,
  );

  return (
    <header className="flex h-full items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 [app-region:drag]">
      <div className="flex min-w-fit items-center gap-3">
        <button
          className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] [app-region:no-drag]"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
        <div className="flex items-baseline gap-2">
          <strong className="text-lg tracking-tight">AIHub</strong>
          <span className="text-xs text-[var(--color-text-muted)]">
            本地多模型工作台
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 overflow-x-auto [app-region:no-drag]">
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-bg-hover)]"
          onClick={() => setComparisonSetupOpen(true)}
        >
          <Columns3 size={14} />
          对比
        </button>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)]"
          onClick={() => setSettingsModalOpen(true)}
          aria-label="打开设置"
        >
          <Settings size={15} />
        </button>
        {PROVIDER_IDS.map((id) => (
          <ProviderStatus
            key={id}
            id={id}
            provider={providers.find((item) => item.id === id)}
          />
        ))}
        <button
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 hover:bg-[var(--color-bg-hover)]"
          onClick={() =>
            setTheme(
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark",
            )
          }
          aria-label="切换主题"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

function ProviderStatus({
  provider,
  id,
}: {
  provider: ProviderSummary | undefined;
  id: ProviderId;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      <i
        className="size-2 rounded-full"
        style={{
          background: provider?.degraded
            ? "var(--color-danger)"
            : provider?.authenticated
              ? "var(--color-online)"
              : "var(--color-offline)",
          boxShadow:
            provider?.authenticated && !provider.degraded
              ? "0 0 8px var(--color-online-glow)"
              : undefined,
        }}
      />
      <span>{PROVIDER_LABELS[id]}</span>
      <button
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 hover:bg-[var(--color-bg-hover)]"
        onClick={() =>
          void window.aihub.setProviderWebsiteVisible(
            id,
            !provider?.websiteVisible,
          )
        }
      >
        {provider?.websiteVisible ? "返回工作台" : "登录 / 修复"}
      </button>
    </div>
  );
}
