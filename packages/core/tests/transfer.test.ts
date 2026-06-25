import { describe, expect, it } from "vitest";
import {
  buildTransferDraft,
  validateTransferMarkdown,
  type NormalizedConversation,
} from "../src";

describe("transfer document", () => {
  it("keeps only the latest five turns verbatim and includes all headings", () => {
    const conversation: NormalizedConversation = {
      id: "conversation",
      title: "Test",
      provider: "chatgpt",
      hidden: false,
      pinned: false,
      documentIds: [],
      tagIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: Array.from({ length: 7 }, (_, index) => ({
        id: `message-${index}`,
        conversationId: "conversation",
        role: index % 2 ? "assistant" : "user",
        content: [{ type: "text" as const, text: `turn-${index}` }],
        status: "completed" as const,
        provider: "chatgpt" as const,
        createdAt: new Date().toISOString(),
      })),
    };

    const result = buildTransferDraft(conversation);
    expect(validateTransferMarkdown(result)).toBe(true);
    expect(result).not.toContain("### User\nturn-0");
    expect(result).toContain("turn-6");
  });
});
