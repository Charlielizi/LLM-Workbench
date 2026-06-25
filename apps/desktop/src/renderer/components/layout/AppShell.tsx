import { useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { useSettingsStore } from "../../stores/settings-store";

interface AppShellProps {
  sidebarWidth: number;
  providerDrawerOpen: boolean;
  topbar: ReactNode;
  sidebar: ReactNode;
  workspace: ReactNode;
  modals?: ReactNode;
  toasts?: ReactNode;
}

export function AppShell({
  sidebarWidth,
  providerDrawerOpen,
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
    const next = Math.min(
      Math.max(320, width),
      Math.max(320, window.innerWidth - sidebarWidth - 360),
    );
    setDrawerWidth(next);
    void window.aihub.setProviderLayout(next);
  }

  return (
    <div
      className="grid h-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
      style={{
        gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr) ${
          providerDrawerOpen ? drawerWidth : 0
        }px`,
        gridTemplateRows: "var(--topbar-height) minmax(0, 1fr)",
        backgroundImage:
          "radial-gradient(circle at 85% 10%, var(--color-accent-glow), transparent 28%)",
      }}
    >
      <div className="col-span-3 min-w-0">{topbar}</div>
      <div className="min-h-0 min-w-0">{sidebar}</div>
      <div className="relative min-h-0 min-w-0">
        {workspace}
        {providerDrawerOpen && (
          <div
            className="absolute inset-y-0 right-[-3px] z-20 w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--color-accent)]"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={() => {
              dragStart.current = undefined;
            }}
          />
        )}
      </div>
      <div className="min-h-0 min-w-0" aria-hidden />
      {modals}
      {toasts}
    </div>
  );
}
