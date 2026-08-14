import { describe, expect, it } from "vitest";
import {
  normalizeProviderDrawerWidth,
  normalizeProviderSplitRatio,
  providerSurfaceLayoutFromRect,
  shouldUseNarrowPaneLayout,
} from "../src/renderer/utils/layout";

describe("normalizeProviderDrawerWidth", () => {
  it("rounds drag widths before they cross IPC", () => {
    expect(normalizeProviderDrawerWidth(520.4)).toBe(520);
    expect(normalizeProviderDrawerWidth(520.6)).toBe(521);
  });

  it("clamps the global provider split ratio", () => {
    expect(normalizeProviderSplitRatio(0.1)).toBe(0.25);
    expect(normalizeProviderSplitRatio(0.42)).toBe(0.42);
    expect(normalizeProviderSplitRatio(0.9)).toBe(0.7);
  });

  it("switches to a single pane only when both minimums cannot fit", () => {
    expect(shouldUseNarrowPaneLayout(960, 270)).toBe(true);
    expect(shouldUseNarrowPaneLayout(1_280, 270)).toBe(false);
  });

  it("normalizes the measured provider slot for zoom-safe IPC", () => {
    expect(providerSurfaceLayoutFromRect(
      { x: 720, y: 84, width: 480, height: 716 },
      1_200,
      800,
      true,
    )).toEqual({
      surfaceVisible: true,
      x: 0.6,
      y: 0.105,
      width: 0.4,
      height: 0.895,
    });
    expect(providerSurfaceLayoutFromRect(
      { x: 0, y: 0, width: 0, height: 0 },
      1_200,
      800,
      false,
    ).surfaceVisible).toBe(false);
    expect(providerSurfaceLayoutFromRect(
      { x: 1_200, y: 84, width: 1, height: 716 },
      1_200,
      800,
      true,
    )).toEqual({
      surfaceVisible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
