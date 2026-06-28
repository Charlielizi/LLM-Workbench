import { describe, expect, it } from "vitest";
import { normalizeProviderDrawerWidth } from "../src/renderer/utils/layout";

describe("normalizeProviderDrawerWidth", () => {
  it("rounds drag widths before they cross IPC", () => {
    expect(normalizeProviderDrawerWidth(520.4)).toBe(520);
    expect(normalizeProviderDrawerWidth(520.6)).toBe(521);
  });
});
