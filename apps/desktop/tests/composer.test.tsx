// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAppSettings,
  type NormalizedConversation,
} from "@aihub/core";
import {
  Composer,
  measureComposerHeight,
} from "../src/renderer/components/composer/Composer";
import { useAppStore } from "../src/renderer/stores/app-store";
import { useComposerStore } from "../src/renderer/stores/composer-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../src/renderer/stores/settings-store";
import { useToastStore } from "../src/renderer/stores/toast-store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const conversation: NormalizedConversation = {
  id: "conversation-1",
  title: "Composer test",
  provider: "chatgpt",
  hidden: false,
  pinned: false,
  documentIds: [],
  tagIds: [],
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  messages: [],
};

describe("Composer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.aihub = {
      getLocalFilePath: vi.fn(() => ""),
    } as unknown as Window["aihub"];
    useComposerStore.setState({ drafts: {}, modes: {}, models: {} });
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({
      ...normalizeAppSettings({
        locale: "en-US",
        density: "comfortable",
        shortcuts: DEFAULT_SHORTCUTS,
      }),
      shortcuts: DEFAULT_SHORTCUTS,
      hydrated: false,
      repairedShortcuts: false,
      syncError: undefined,
    });
    useAppStore.setState({
      snapshot: {
        providers: [{
          id: "chatgpt",
          authenticated: true,
          ready: true,
          degraded: false,
          websiteVisible: false,
        }],
        conversations: [conversation],
        comparisons: [],
      },
      selectedConversationId: conversation.id,
      busyConversations: new Set(),
      streamingConversations: new Set(),
      messageErrors: new Map(),
      providerCapabilities: {},
      systemPrompts: [],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("grows and shrinks with content while respecting density and viewport limits", async () => {
    await act(async () => root.render(<Composer conversation={conversation} />));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="composer-input"]',
    )!;
    let scrollHeight = 140;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    await act(async () => {
      useComposerStore.getState().setDraft(conversation.id, "long draft");
    });
    expect(textarea.style.height).toBe("140px");
    expect(textarea.style.overflowY).toBe("hidden");

    scrollHeight = 20;
    await act(async () => {
      useComposerStore.getState().setDraft(conversation.id, "short");
    });
    expect(textarea.style.height).toBe("56px");

    scrollHeight = 900;
    await act(async () => {
      useComposerStore.getState().setDraft(conversation.id, "very long");
    });
    expect(Number.parseInt(textarea.style.height, 10)).toBeLessThanOrEqual(320);
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("clears immediately after optimistic acceptance and restores a safe failed draft", async () => {
    let finish: (success: boolean) => void = () => {};
    const completion = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const sendMessage = vi.fn(() => completion);
    useAppStore.setState({ sendMessage });
    useComposerStore.getState().setDraft(conversation.id, "send me");
    await act(async () => root.render(<Composer conversation={conversation} />));

    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="send-message"]',
      )!.click();
    });
    expect(useComposerStore.getState().getDraft(conversation.id)).toBe("");

    await act(async () => finish(false));
    expect(useComposerStore.getState().getDraft(conversation.id)).toBe(
      "send me",
    );
  });

  it("does not overwrite a newer draft when the previous send fails", async () => {
    let finish: (success: boolean) => void = () => {};
    const completion = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    useAppStore.setState({ sendMessage: vi.fn(() => completion) });
    useComposerStore.getState().setDraft(conversation.id, "first draft");
    await act(async () => root.render(<Composer conversation={conversation} />));

    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="send-message"]',
      )!.click();
    });
    await act(async () => {
      useComposerStore.getState().setDraft(conversation.id, "next draft");
    });
    await act(async () => finish(false));
    expect(useComposerStore.getState().getDraft(conversation.id)).toBe(
      "next draft",
    );
  });

  it("renders the active stop control with a danger treatment", async () => {
    useAppStore.setState({
      streamingConversations: new Set([conversation.id]),
    });
    await act(async () => root.render(<Composer conversation={conversation} />));
    const stop = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-generation"]',
    )!;
    expect(stop.className).toContain("bg-[var(--color-danger)]");
    expect(stop.getAttribute("aria-label")).toBe("Stop generation");
  });
});

describe("measureComposerHeight", () => {
  it("uses compact and comfortable minimums and the proportional maximum", () => {
    expect(measureComposerHeight(10, "comfortable", 800)).toBe(56);
    expect(measureComposerHeight(10, "compact", 800)).toBe(44);
    expect(measureComposerHeight(900, "comfortable", 800)).toBe(304);
    expect(measureComposerHeight(900, "comfortable", 2_000)).toBe(320);
  });
});
