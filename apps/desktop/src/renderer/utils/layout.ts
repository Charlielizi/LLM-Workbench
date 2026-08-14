import {
  normalizeProviderSplitRatio as normalizeCoreProviderSplitRatio,
  type ProviderSurfaceLayout,
} from "@aihub/core";

export const MIN_CLIENT_WORKSPACE_WIDTH = 420;
export const MIN_PROVIDER_PANE_WIDTH = 360;

export function normalizeProviderDrawerWidth(width: number): number {
  return Math.round(width);
}

export function normalizeProviderSplitRatio(ratio: number): number {
  return normalizeCoreProviderSplitRatio(ratio);
}

export function shouldUseNarrowPaneLayout(
  viewportWidth: number,
  sidebarWidth: number,
): boolean {
  return (
    viewportWidth - sidebarWidth <
    MIN_CLIENT_WORKSPACE_WIDTH + MIN_PROVIDER_PANE_WIDTH
  );
}

export function providerSurfaceLayoutFromRect(
  rect: Pick<DOMRect, "x" | "y" | "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
  surfaceVisible: boolean,
): ProviderSurfaceLayout {
  if (
    !surfaceVisible ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return {
      surfaceVisible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(rect.x / viewportWidth);
  const y = clamp(rect.y / viewportHeight);
  const right = clamp((rect.x + rect.width) / viewportWidth);
  const bottom = clamp((rect.y + rect.height) / viewportHeight);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) {
    return {
      surfaceVisible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }
  return {
    surfaceVisible: true,
    x,
    y,
    width,
    height,
  };
}
