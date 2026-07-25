// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot } from "@aihub/core";
import { useAppStore } from "../src/renderer/stores/app-store";
import { ChatView } from "../src/renderer/components/chat/ChatView";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock("../src/renderer/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("../src/renderer/components/composer/Composer", () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock("../src/renderer/components/welcome/WelcomeView", () => ({
  WelcomeView: () => <div data-testid="welcome-view" />,
}));

describe("ChatView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.aihub = {
      setProviderWebsiteVisible: vi.fn(),
      recoverProvider: vi.fn(),
      submitProviderEnter: vi.fn(),
      captureProviderAnchor: vi.fn(),
      syncLatestProviderResponse: vi.fn(),
      getProviderDebugSnapshot: vi.fn(),
      getLatestProviderSmokeResult: vi.fn(),
      getProviderSmokeInspection: vi.fn().mockResolvedValue({
        provider: "chatgpt",
        status: "missing",
      }),
      listProviderAdapterEvents: vi.fn(),
    } as unknown as Window["aihub"];
    useAppStore.setState({
      snapshot: snapshotFixture(),
      selectedConversationId: "chatgpt-conversation",
      busy: false,
      error: undefined,
      busyConversations: new Set(),
      messageErrors: new Map(),
      transfer: undefined,
      streamingConversations: new Set(),
      providerCapabilities: {},
      searchResults: undefined,
      searchQuery: "",
      shortcutHelpOpen: false,
      systemPrompts: [],
      systemPromptModalOpen: false,
      comparisonSetupOpen: false,
      activeComparisonId: undefined,
      documents: [],
      folders: [],
      tags: [],
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps the primary toolbar to four accessible actions", async () => {
    await act(async () => {
      root.render(<ChatView />);
      await Promise.resolve();
    });

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const buttons = header!.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    expect(getButton(container, "Open provider page")).toBeTruthy();
    expect(getButton(container, "Transfer conversation")).toBeTruthy();
    expect(getButton(container, "Compare")).toBeTruthy();
    expect(getButton(container, "More actions")).toBeTruthy();
    expect(header!.textContent).not.toContain("Diagnostics");
    expect(
      header!.querySelector('button[title="Toggle provider clean mode"]'),
    ).toBeNull();
  });
});

function getButton(container: HTMLElement, title: string): HTMLButtonElement {
  const button = container.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(
      `Button with title "${title}" was not found. HTML: ${container.innerHTML}`,
    );
  }
  return button;
}

function snapshotFixture(): AppSnapshot {
  return {
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
        authenticated: true,
        ready: true,
        degraded: false,
        websiteVisible: false,
      },
    ],
    conversations: [
      {
        id: "chatgpt-conversation",
        provider: "chatgpt",
        title: "ChatGPT conversation",
        messages: [],
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      {
        id: "claude-conversation",
        provider: "claude",
        title: "Claude conversation",
        messages: [],
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ],
    comparisons: [],
  };
}
