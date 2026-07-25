import { useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { normalizeProviderDrawerWidth } from "../../utils/layout";

interface AppShellProps {
  sidebarWidth: number;
  providerDrawerOpen: boolean;
  menubar: ReactNode;
  topbar: ReactNode;
  sidebar: ReactNode;
  workspace: ReactNode;
  modals?: ReactNode;
  toasts?: ReactNode;
}

export function AppShell({
  sidebarWidth,
  providerDrawerOpen,
  menubar,
  topbar,
  sidebar,
  workspace,
  modals,
  toasts,
}: AppShellProps) {
  const drawerWidth = useSettingsStore(
    (state) => state.providerDrawerWidth,
  );
  const setDrawerWidth = useSettingsStore(
    (state) => state.setProviderDrawerWidth,
  );
  const dragStart = useRef<{ x: number; width: number } | undefined>(
    undefined,
  );

  function startResize(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: event.clientX, width: drawerWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const width = dragStart.current.width - event.clientX + dragStart.current.x;
    const next = normalizeProviderDrawerWidth(Math.min(
      Math.max(320, width),
      Math.max(320, window.innerWidth - sidebarWidth - 360),
    ));
    setDrawerWidth(next);
    void window.aihub.setProviderLayout(next);
  }

  return (
    <div
      data-testid="app-shell"
      className="grid h-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
      style={{
        gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr) ${
          providerDrawerOpen ? drawerWidth : 0
        }px`,
        gridTemplateRows: "var(--menubar-height) var(--topbar-height) minmax(0, 1fr)",
      }}
    >
      <div className="col-span-3 min-w-0 border-b border-[var(--color-border-light)]">
        {menubar}
      </div>
      <div className="col-span-3 min-w-0 border-b border-[var(--color-border-light)]">
        {topbar}
      </div>
      <div className="min-h-0 min-w-0 border-r border-[var(--color-border-light)]">
        {sidebar}
      </div>
      <div className="relative min-h-0 min-w-0">
        {workspace}
        {providerDrawerOpen && (
          <div
            className="absolute inset-y-0 right-[-4px] z-20 w-2 cursor-col-resize bg-transparent transition hover:bg-[var(--color-bg-hover)]"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={() => {
              dragStart.current = undefined;
            }}
          />
        )}
      </div>
      <div
        data-testid="provider-drawer-slot"
        className={`min-h-0 min-w-0 border-l border-[var(--color-border-light)] transition-opacity ${
          providerDrawerOpen ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
      {modals}
      {toasts}
    </div>
  );
}
