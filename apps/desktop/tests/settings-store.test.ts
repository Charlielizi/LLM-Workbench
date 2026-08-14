// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings } from "@aihub/core";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../src/renderer/stores/settings-store";

describe("settings persistence", () => {
  beforeEach(() => {
    const normalized = normalizeAppSettings({
      theme: "system",
      locale: "en-US",
      shortcuts: DEFAULT_SHORTCUTS,
    });
    useSettingsStore.setState({
      ...normalized,
      shortcuts: { ...DEFAULT_SHORTCUTS },
      hydrated: true,
      repairedShortcuts: false,
      syncError: undefined,
    });
  });

  it("serializes writes and restores the authoritative SQLite value after failure", async () => {
    const setSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("first write failed"))
      .mockRejectedValueOnce(new Error("second write failed"));
    const getSettings = vi.fn().mockResolvedValue({
      theme: "dark",
      locale: "en-US",
      density: "comfortable",
      shortcuts: DEFAULT_SHORTCUTS,
    });
    window.aihub = {
      setSettings,
      getSettings,
    } as unknown as Window["aihub"];

    useSettingsStore.getState().setTheme("light");
    useSettingsStore.getState().setDensity("compact");

    await vi.waitFor(() => expect(setSettings).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getSettings).toHaveBeenCalledOnce());

    expect(setSettings.mock.invocationCallOrder[0]).toBeLessThan(
      setSettings.mock.invocationCallOrder[1]!,
    );
    expect(useSettingsStore.getState()).toMatchObject({
      theme: "dark",
      density: "comfortable",
      syncError: "second write failed",
    });
  });

  it("normalizes the new split ratio while retaining the legacy drawer width", () => {
    expect(normalizeAppSettings({
      providerDrawerWidth: 640,
      providerSplitRatio: 0.9,
    })).toMatchObject({
      providerDrawerWidth: 640,
      providerSplitRatio: 0.7,
    });
    expect(normalizeAppSettings({}).providerSplitRatio).toBe(0.42);
  });
});
