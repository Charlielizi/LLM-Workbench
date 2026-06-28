import { describe, expect, it } from "vitest";
import type { NormalizedConversation, NormalizedMessage } from "@aihub/core";
import { conversationSnapshotSignature } from "../src/renderer/utils/snapshot-signature";

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: [{ type: "text", text: "" }],
    status: "streaming",
    statusPhase: "waiting-first-token",
    provider: "doubao",
    createdAt: "2026-06-28T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(
  overrides: Partial<NormalizedConversation> = {},
): NormalizedConversation {
  return {
    id: "conversation-1",
    title: "Test",
    provider: "doubao",
    hidden: false,
    pinned: false,
    documentIds: [],
    tagIds: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    messages: [message()],
    ...overrides,
  };
}

describe("conversationSnapshotSignature", () => {
  it("changes when the latest message content changes", () => {
    const before = conversationSnapshotSignature(conversation());
    const after = conversationSnapshotSignature(
      conversation({
        messages: [message({ content: [{ type: "text", text: "豆包回答了" }] })],
      }),
    );

    expect(after).not.toBe(before);
  });

  it("changes when the latest message status changes", () => {
    const before = conversationSnapshotSignature(conversation());
    const after = conversationSnapshotSignature(
      conversation({
        messages: [message({ status: "completed", statusPhase: "completed" })],
      }),
    );

    expect(after).not.toBe(before);
  });
});
