import { describe, expect, it } from "vitest";
import { providerDefinitions } from "@aihub/adapters";
import {
  isTransientModeSelection,
  resolveFileInputSelectors,
} from "../src/main/provider-runtime-helpers";

describe("provider runtime helpers", () => {
  it("resolves file input selectors with provider-specific selectors first", () => {
    expect(resolveFileInputSelectors(providerDefinitions.chatgpt)).toEqual([
      "input[data-aihub-file-input='true']",
      "input[type='file'][data-testid*='file']",
      "input[type='file'][accept]",
      "input[type='file']",
    ]);
  });

  it("treats one-shot nested mode selections as transient success", () => {
    expect(
      isTransientModeSelection({ transient: true }, true),
    ).toBe(true);
    expect(
      isTransientModeSelection({ transient: true }, false),
    ).toBe(false);
    expect(
      isTransientModeSelection({ transient: false }, true),
    ).toBe(false);
  });
});
