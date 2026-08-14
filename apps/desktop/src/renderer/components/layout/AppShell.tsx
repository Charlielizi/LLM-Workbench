import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { PanelRightOpen } from "lucide-react";
import { DEFAULT_APP_SETTINGS } from "@aihub/core";
import { useI18n } from "../../i18n";
import { usePaneLayoutStore } from "../../stores/pane-layout-store";
import { useSettingsStore } from "../../stores/settings-store";
import {
  MIN_CLIENT_WORKSPACE_WIDTH,
  MIN_PROVIDER_PANE_WIDTH,
  normalizeProviderSplitRatio,
  providerSurfaceLayoutFromRect,
  shouldUseNarrowPaneLayout,
} from "../../utils/layout";

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
  const { t } = useI18n();
  const persistedRatio = useSettingsStore(
    (state) => state.providerSplitRatio,
  );
  const setPersistedRatio = useSettingsStore(
    (state) => state.setProviderSplitRatio,
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
  const setNarrowLayout = usePaneLayoutStore(
    (state) => state.setNarrowLayout,
  );
  const showLastProvider = usePaneLayoutStore(
    (state) => state.showLastProvider,
  );
  const setActiveNarrowPane = usePaneLayoutStore(
    (state) => state.setActiveNarrowPane,
  );
  const lastProviderId = usePaneLayoutStore(
    (state) => state.lastProviderId,
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [liveRatio, setLiveRatio] = useState(persistedRatio);
  const liveRatioRef = useRef(persistedRatio);
  const shellRef = useRef<HTMLDivElement>(null);
  const providerSlotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const layoutRequestRef = useRef<Promise<void>>(Promise.resolve());
  const dragStart = useRef<{ x: number; ratio: number } | undefined>(
    undefined,
  );

  const narrowLayout =
    clientRequested &&
    providerRequested &&
    shouldUseNarrowPaneLayout(viewportWidth, sidebarWidth);
  const showProvider =
    providerDrawerOpen &&
    providerRequested &&
    (!clientRequested || !narrowLayout || activeNarrowPane === "provider");
  const showClient =
    clientRequested &&
    (!providerRequested ||
      !providerDrawerOpen ||
      !narrowLayout ||
      activeNarrowPane === "client");
  const splitVisible = showClient && showProvider;
  const effectiveSidebarWidth = showClient ? sidebarWidth : 0;
  const availableSplitWidth = Math.max(
    1,
    viewportWidth - effectiveSidebarWidth,
  );
  const providerWidth = splitVisible
    ? Math.round(availableSplitWidth * liveRatio)
    : showProvider
      ? viewportWidth
      : 0;

  useEffect(() => {
    if (!dragStart.current) {
      liveRatioRef.current = persistedRatio;
      setLiveRatio(persistedRatio);
    }
  }, [persistedRatio]);

  useEffect(() => {
    setNarrowLayout(narrowLayout);
  }, [narrowLayout, setNarrowLayout]);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const sendSurfaceLayout = useCallback(() => {
    const rect = providerSlotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const layout = providerSurfaceLayoutFromRect(
      rect,
      window.innerWidth,
      window.innerHeight,
      showProvider,
    );
    layoutRequestRef.current = layoutRequestRef.current
      .catch(() => undefined)
      .then(() => window.aihub.setProviderLayout(layout))
      .catch(() => undefined);
  }, [showProvider]);

  const queueSurfaceLayout = useCallback(() => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      sendSurfaceLayout();
    });
  }, [sendSurfaceLayout]);

  useLayoutEffect(() => {
    sendSurfaceLayout();
    const layoutTimer = window.setTimeout(sendSurfaceLayout, 0);
    const shell = shellRef.current;
    const observer =
      shell && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(queueSurfaceLayout)
        : undefined;
    if (shell) observer?.observe(shell);
    window.addEventListener("resize", queueSurfaceLayout);
    return () => {
      window.clearTimeout(layoutTimer);
      observer?.disconnect();
      window.removeEventListener("resize", queueSurfaceLayout);
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [
    effectiveSidebarWidth,
    liveRatio,
    providerWidth,
    queueSurfaceLayout,
    sendSurfaceLayout,
    showProvider,
  ]);

  function ratioBounds(): { min: number; max: number } {
    const min = Math.max(0.25, MIN_PROVIDER_PANE_WIDTH / availableSplitWidth);
    const max = Math.min(
      0.7,
      1 - MIN_CLIENT_WORKSPACE_WIDTH / availableSplitWidth,
    );
    return { min, max: Math.max(min, max) };
  }

  function clampLiveRatio(value: number): number {
    const bounds = ratioBounds();
    return Math.min(bounds.max, Math.max(bounds.min, value));
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: event.clientX, ratio: liveRatio };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const delta = event.clientX - dragStart.current.x;
    const next = clampLiveRatio(
      dragStart.current.ratio - delta / availableSplitWidth,
    );
    liveRatioRef.current = next;
    setLiveRatio(next);
  }

  function finishResize() {
    if (!dragStart.current) return;
    dragStart.current = undefined;
    setPersistedRatio(normalizeProviderSplitRatio(liveRatioRef.current));
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | undefined;
    if (event.key === "ArrowLeft") next = liveRatio + 0.02;
    if (event.key === "ArrowRight") next = liveRatio - 0.02;
    if (event.key === "Home") next = ratioBounds().min;
    if (event.key === "End") next = ratioBounds().max;
    if (next === undefined) return;
    event.preventDefault();
    const normalized = clampLiveRatio(next);
    liveRatioRef.current = normalized;
    setLiveRatio(normalized);
    setPersistedRatio(normalized);
  }

  return (
    <div
      ref={shellRef}
      data-testid="app-shell"
      data-pane-layout={
        splitVisible
          ? "split"
          : showProvider
            ? "provider-only"
            : "client-only"
      }
      className="grid h-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
      style={{
        gridTemplateColumns: `${effectiveSidebarWidth}px minmax(0, 1fr) ${providerWidth}px`,
        gridTemplateRows:
          "var(--menubar-height) var(--topbar-height) minmax(0, 1fr)",
      }}
    >
      <div className="col-span-3 min-w-0 border-b border-[var(--color-border-light)]">
        {menubar}
      </div>
      <div className="col-span-3 min-w-0 border-b border-[var(--color-border-light)]">
        {topbar}
      </div>
      <div
        className="min-h-0 min-w-0 overflow-hidden border-r border-[var(--color-border-light)]"
        aria-hidden={!showClient}
        onPointerDown={() => setActiveNarrowPane("client")}
      >
        {showClient && sidebar}
      </div>
      <div
        className="relative min-h-0 min-w-0 overflow-hidden"
        aria-hidden={!showClient}
        onPointerDown={() => setActiveNarrowPane("client")}
      >
        {showClient && workspace}
        {splitVisible && (
          <div
            data-testid="provider-resize-handle"
            role="separator"
            aria-label={t("layout.resize")}
            aria-orientation="vertical"
            aria-valuemin={Math.round(ratioBounds().min * 100)}
            aria-valuemax={Math.round(ratioBounds().max * 100)}
            aria-valuenow={Math.round(liveRatio * 100)}
            tabIndex={0}
            className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize bg-transparent transition hover:bg-[var(--color-bg-hover)] focus-visible:bg-[var(--color-bg-hover)]"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={resizeWithKeyboard}
            onDoubleClick={() => {
              const ratio = DEFAULT_APP_SETTINGS.providerSplitRatio;
              liveRatioRef.current = ratio;
              setLiveRatio(ratio);
              setPersistedRatio(ratio);
            }}
          />
        )}
        {showClient && !providerRequested && lastProviderId && (
          <button
            type="button"
            data-testid="restore-provider-pane"
            className="interactive-chip absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-l-xl border border-r-0 border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-3 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-md)]"
            onClick={showLastProvider}
            title={t("layout.showProvider")}
            aria-label={t("layout.showProvider")}
          >
            <PanelRightOpen size={15} />
          </button>
        )}
      </div>
      <div
        ref={providerSlotRef}
        data-testid="provider-drawer-slot"
        className={`min-h-0 min-w-0 border-l border-[var(--color-border-light)] ${
          showProvider ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden
      />
      {modals}
      {toasts}
    </div>
  );
}
