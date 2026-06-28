import { describe, expect, it } from "vitest";
import { providerDefinitions } from "@aihub/adapters";

describe("providerDefinitions", () => {
  it("does not treat generic doubao login buttons as auth blockers", () => {
    expect(providerDefinitions.doubao.loginMarkers).not.toContain(
      "button[class*='login']",
    );
    expect(providerDefinitions.doubao.authBlockerSelectors).not.toContain(
      "button[class*='login-btn-header']",
    );
    expect(providerDefinitions.doubao.authBlockerSelectors).not.toContain(
      "button[class*='login']",
    );
  });
});
