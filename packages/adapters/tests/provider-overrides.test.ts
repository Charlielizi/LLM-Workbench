import { describe, expect, it } from "vitest";
import { providerDefinitions } from "../src";

describe("provider overrides", () => {
  it("marks Hunyuan login overlays as auth blockers", () => {
    expect(providerDefinitions.hunyuan.authBlockerSelectors).toContain(
      ".agent-dialogue__tool__login",
    );
  });

  it("does not treat Hunyuan tools as verified attachment controls", () => {
    expect(providerDefinitions.hunyuan.attachmentControlSelectors).toEqual([]);
    expect(providerDefinitions.hunyuan.attachmentCapabilityConfidence).toBe("unverified");
  });

  it("supports Qianwen overflow menu tools", () => {
    const openerLabels = providerDefinitions.qianwen.modeDefinitions
      .filter((item) =>
        item.mode === "image-generation" ||
        item.mode === "coding" ||
        item.mode === "documents"
      )
      .flatMap((item) => item.openerLabels ?? []);

    expect(openerLabels).toContain("更多");
  });
});
