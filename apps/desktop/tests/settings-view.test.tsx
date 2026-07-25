// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings, PROVIDER_IDS } from "@aihub/core";
import { SettingsView } from "../src/renderer/components/settings/SettingsView";
import { useAppStore } from "../src/renderer/stores/app-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../src/renderer/stores/settings-store";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("SettingsView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const normalized = normalizeAppSettings({
      locale: "en-US",
      defaultProvider: "chatgpt",
      enabledProviders: [...PROVIDER_IDS],
      providerOrder: [...PROVIDER_IDS],
      shortcuts: DEFAULT_SHORTCUTS,
    });
    useSettingsStore.setState({
      ...normalized,
      shortcuts: { ...DEFAULT_SHORTCUTS },
      hydrated: false,
      syncError: undefined,
      repairedShortcuts: false,
    });
    useAppStore.setState({
      settingsSection: "general",
      workspaceView: "settings",
      previousWorkspaceView: "conversation",
      providerBeforeSettings: undefined,
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
            authenticated: true,
            ready: false,
            degraded: false,
            websiteVisible: true,
          },
        ],
        conversations: [],
        comparisons: [],
      },
      documents: [],
      folders: [],
      tags: [],
      systemPrompts: [],
    });
    window.aihub = {
      setProviderWebsiteVisible: vi.fn().mockResolvedValue(undefined),
      getStorageSummary: vi.fn().mockResolvedValue({
        userDataPath: "C:\\AIHub",
        databaseBytes: 1024,
        conversationCount: 1,
        messageCount: 2,
        documentCount: 0,
        documentBytes: 0,
        indexedCharacterCount: 0,
      }),
      previewSettingsImport: vi.fn().mockResolvedValue({
        candidate: { theme: "dark" },
        changes: [{ key: "theme", before: "light", after: "dark" }],
        ignoredKeys: ["futureSetting"],
        warnings: ["Unsupported settings were ignored."],
      }),
    } as unknown as Window["aihub"];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders nine keyboard buttons and previews appearance and provider state", async () => {
    await act(async () => root.render(<SettingsView />));
    expect(container.querySelectorAll("nav button")).toHaveLength(9);

    await clickButton("Appearance");
    const densityLabel = findLabel("Density");
    const density = densityLabel.querySelector("select");
    expect(density).not.toBeNull();
    await act(async () => {
      density!.value = "compact";
      density!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.dataset.density).toBe("compact");

    await clickButton("Providers & sync");
    expect(container.textContent).toContain("Website drawer open");
    expect(container.textContent).toContain("Not ready");
    const chatGptToggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="Enabled ChatGPT"]',
    );
    expect(chatGptToggle).not.toBeNull();
    await act(async () => chatGptToggle!.click());
    expect(useSettingsStore.getState().enabledProviders).not.toContain(
      "chatgpt",
    );
    expect(useSettingsStore.getState().defaultProvider).toBe("claude");

    await act(async () =>
      useSettingsStore.setState({
        enabledProviders: ["claude"],
        defaultProvider: "claude",
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Enabled Claude"]',
      )?.disabled,
    ).toBe(true);
  });

  it("renders before, after, ignored fields, and warnings in import preview", async () => {
    await act(async () => root.render(<SettingsView />));
    await clickButton("Data & privacy");
    await act(async () => Promise.resolve());

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName === "input") {
          Object.defineProperty(element, "files", {
            configurable: true,
            value: [
              {
                text: () =>
                  Promise.resolve(
                    JSON.stringify({ theme: "dark", futureSetting: true }),
                  ),
              },
            ],
          });
          element.click = () => {
            element.onchange?.(new Event("change"));
          };
        }
        return element;
      }) as typeof document.createElement,
    );

    await clickButton("Import settings");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Current value"),
    );
    expect(container.textContent).toContain("Imported value");
    expect(container.textContent).toContain("light");
    expect(container.textContent).toContain("dark");
    expect(container.textContent).toContain("futureSetting");
    expect(container.textContent).toContain(
      "Unsupported settings were ignored.",
    );
  });

  it("cancels shortcut recording with Escape without changing the binding", async () => {
    await act(async () => root.render(<SettingsView />));
    await clickButton("Shortcuts");
    const recorder = container.querySelector<HTMLButtonElement>(
      'button[title="Focus search"]',
    );
    expect(recorder).not.toBeNull();
    await act(async () => recorder!.click());
    expect(recorder!.textContent).toContain("Press a shortcut");
    await act(async () => {
      recorder!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(recorder!.textContent).toContain("Ctrl+K");
    expect(useSettingsStore.getState().shortcuts.focusSearch).toBe("Ctrl+K");
  });

  it("restores the previous workspace and provider drawer after settings", () => {
    useAppStore.setState({
      workspaceView: "comparison",
      activeComparisonId: "comparison-1",
    });

    useAppStore.getState().openSettings();
    expect(useAppStore.getState()).toMatchObject({
      workspaceView: "settings",
      previousWorkspaceView: "comparison",
      providerBeforeSettings: "claude",
    });
    expect(window.aihub.setProviderWebsiteVisible).toHaveBeenCalledWith(
      "claude",
      false,
    );

    useAppStore.getState().closeSettings();
    expect(useAppStore.getState().workspaceView).toBe("comparison");
    expect(window.aihub.setProviderWebsiteVisible).toHaveBeenLastCalledWith(
      "claude",
      true,
    );
  });

  function findLabel(text: string): HTMLLabelElement {
    const label = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent?.includes(text),
    );
    if (!label) throw new Error(`Label not found: ${text}`);
    return label;
  }

  async function clickButton(name: string): Promise<void> {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!button) throw new Error(`Button not found: ${name}`);
    await act(async () => button.click());
  }
});
