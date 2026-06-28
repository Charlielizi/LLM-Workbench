import { describe, expect, it } from "vitest";
import { providerDefinitions } from "@aihub/adapters";
import { shouldShowAttachmentControl } from "../src/renderer/utils/provider-capabilities";

describe("attachment capability visibility", () => {
  it("hides unverified attachment controls", () => {
    expect(shouldShowAttachmentControl(providerDefinitions.claude)).toBe(false);
    expect(shouldShowAttachmentControl(providerDefinitions.hunyuan)).toBe(false);
  });

  it("shows verified attachment controls without runtime capabilities", () => {
    expect(shouldShowAttachmentControl(providerDefinitions.chatgpt)).toBe(true);
    expect(shouldShowAttachmentControl(providerDefinitions.doubao)).toBe(true);
  });

  it("requires runtime confirmation for partial providers", () => {
    expect(shouldShowAttachmentControl(providerDefinitions.qianwen)).toBe(false);
    expect(
      shouldShowAttachmentControl(providerDefinitions.qianwen, {
        attachments: ["image"],
        modes: [],
        model: undefined,
        models: [],
        multipleAttachments: false,
        acceptedTypes: [],
      }),
    ).toBe(true);
  });
});
