// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings } from "@aihub/core";
import { TopBar } from "../src/renderer/components/layout/TopBar";
import { WelcomeView } from "../src/renderer/components/welcome/WelcomeView";
import { useAppStore } from "../src/renderer/stores/app-store";
import { usePaneLayoutStore } from "../src/renderer/stores/pane-layout-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../src/renderer/stores/settings-store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("P0 provider status actions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const createConversation = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.aihub = {
      setProviderWebsiteVisible: vi.fn().mockResolvedValue(undefined),
    } as unknown as Window["aihub"];
    useSettingsStore.setState({
      ...normalizeAppSettings({
        locale: "en-US",
        hasCompletedOnboarding: true,
        enabledProviders: ["chatgpt", "claude", "doubao"],
        providerOrder: ["chatgpt", "claude", "doubao"],
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
    useAppStore.setState({
      snapshot: {
        providers: [
          {
            id: "chatgpt",
            authenticated: true,
            ready: true,
            degraded: false,
            websiteVisible: false,
          },
          {
            id: "claude",
            authenticated: false,
            ready: false,
            degraded: false,
            websiteVisible: false,
          },
          {
            id: "doubao",
            authenticated: false,
            ready: false,
            degraded: true,
            websiteVisible: false,
          },
        ],
        conversations: [],
        comparisons: [],
      },
      createConversation,
      setComparisonSetupOpen: vi.fn(),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    createConversation.mockClear();
    vi.restoreAllMocks();
  });

  it("uses status shapes as well as color in the top bar", async () => {
    await act(async () => root.render(<TopBar />));
    const chatgpt = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="ChatGPT"][aria-label*="Available"]',
    )!;
    const claude = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="Claude"][aria-label*="Sign-in required"]',
    )!;
    const doubao = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="豆包"][aria-label*="Degraded"]',
    )!;
    expect(chatgpt.querySelector(".lucide-circle-check")).not.toBeNull();
    expect(claude.querySelector(".lucide-log-in")).not.toBeNull();
    expect(doubao.querySelector(".lucide-triangle-alert")).not.toBeNull();
  });

  it("offers sign-in, recovery, and start-chat actions from the welcome view", async () => {
    await act(async () => root.render(<WelcomeView />));
    expect(container.textContent).toContain("Start chat");
    expect(container.textContent).toContain("Open and sign in");
    expect(container.textContent).toContain("Open and recover");

    const chatgptCard = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("ChatGPT") &&
        button.textContent.includes("Start chat"),
    )!;
    await act(async () => chatgptCard.click());
    expect(createConversation).toHaveBeenCalledWith("chatgpt");

    const claudeCard = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("Claude") &&
        button.textContent.includes("Open and sign in"),
    )!;
    await act(async () => claudeCard.click());
    expect(window.aihub.setProviderWebsiteVisible).toHaveBeenCalledWith(
      "claude",
      true,
    );
  });
});
