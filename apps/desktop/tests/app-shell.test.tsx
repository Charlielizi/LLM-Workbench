// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings } from "@aihub/core";
import { AppShell } from "../src/renderer/components/layout/AppShell";
import { usePaneLayoutStore } from "../src/renderer/stores/pane-layout-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../src/renderer/stores/settings-store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("AppShell", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frame = 0;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1_280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(++frame);
      return frame;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    window.aihub = {
      setProviderLayout: vi.fn().mockResolvedValue(undefined),
      setProviderWebsiteVisible: vi.fn().mockResolvedValue(undefined),
    } as unknown as Window["aihub"];
    useSettingsStore.setState({
      ...normalizeAppSettings({
        locale: "en-US",
        providerSplitRatio: 0.42,
        shortcuts: DEFAULT_SHORTCUTS,
      }),
      shortcuts: DEFAULT_SHORTCUTS,
      hydrated: false,
      repairedShortcuts: false,
      syncError: undefined,
    });
    usePaneLayoutStore.setState({
      clientRequested: true,
      providerRequested: false,
      activeNarrowPane: "client",
      lastActivePane: "client",
      lastProviderId: undefined,
      narrowLayout: false,
    });
    usePaneLayoutStore.getState().syncProviderVisibility("chatgpt");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function shell() {
    return (
      <AppShell
        sidebarWidth={270}
        providerDrawerOpen
        menubar={<div>menu</div>}
        topbar={<div>top</div>}
        sidebar={<div data-testid="sidebar-content">sidebar</div>}
        workspace={<div data-testid="workspace-content">workspace</div>}
      />
    );
  }

  it("resizes by keyboard and enforces that one pane always remains visible", async () => {
    await act(async () => root.render(shell()));
    const appShell = container.querySelector<HTMLElement>(
      '[data-testid="app-shell"]',
    )!;
    expect(appShell.dataset.paneLayout).toBe("split");

    const separator = container.querySelector<HTMLElement>(
      '[data-testid="provider-resize-handle"]',
    )!;
    await act(async () => {
      separator.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      );
    });
    expect(useSettingsStore.getState().providerSplitRatio).toBe(0.44);

    await act(async () => usePaneLayoutStore.getState().hideClient());
    expect(appShell.dataset.paneLayout).toBe("provider-only");
    expect(container.querySelector('[data-testid="sidebar-content"]')).toBeNull();

    await act(async () => usePaneLayoutStore.getState().showClient());
    await act(async () => usePaneLayoutStore.getState().hideProvider());
    expect(appShell.dataset.paneLayout).toBe("client-only");

    await act(async () => usePaneLayoutStore.getState().hideClient());
    expect(usePaneLayoutStore.getState().clientRequested).toBe(true);
    expect(appShell.dataset.paneLayout).toBe("client-only");
  });

  it("uses a single active pane when narrow and restores the split when widened", async () => {
    await act(async () => root.render(shell()));
    const appShell = container.querySelector<HTMLElement>(
      '[data-testid="app-shell"]',
    )!;

    await act(async () => {
      window.innerWidth = 960;
      window.dispatchEvent(new Event("resize"));
    });
    expect(usePaneLayoutStore.getState().narrowLayout).toBe(true);
    expect(appShell.dataset.paneLayout).toBe("provider-only");

    await act(async () =>
      usePaneLayoutStore.getState().setActiveNarrowPane("client"),
    );
    expect(appShell.dataset.paneLayout).toBe("client-only");

    await act(async () => {
      window.innerWidth = 1_280;
      window.dispatchEvent(new Event("resize"));
    });
    expect(usePaneLayoutStore.getState().narrowLayout).toBe(false);
    expect(appShell.dataset.paneLayout).toBe("split");
  });
});
