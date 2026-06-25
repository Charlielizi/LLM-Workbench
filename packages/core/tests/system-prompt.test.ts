import { describe, expect, it } from "vitest";
import { wrapWithSystemPrompt } from "../src";

describe("system prompt wrapping", () => {
  it("wraps provider-bound instructions without changing the user payload", () => {
    const result = wrapWithSystemPrompt("Hello", "Be concise.");
    expect(result).toContain("Be concise.");
    expect(result.endsWith("Hello")).toBe(true);
  });

  it("does not wrap an empty instruction", () => {
    expect(wrapWithSystemPrompt("Hello", " ")).toBe("Hello");
  });
});
