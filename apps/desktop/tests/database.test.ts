import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/main/database";

let database: AppDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("AppDatabase", () => {
  it("restores conversations independently from provider DOM state", () => {
    database = new AppDatabase(":memory:");
    const conversation = database.createConversation({
      id: "conversation-1",
      title: "Persisted conversation",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "message-1",
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "Remember this locally." }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });

    const restored = database.getConversation(conversation.id);
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "Remember this locally.",
    });
  });

  it("persists streamed fragments and final message state", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "conversation-2",
      title: "Streaming",
      provider: "claude",
    });
    database.addMessage({
      id: "message-2",
      conversationId: "conversation-2",
      role: "assistant",
      content: [{ type: "text", text: "" }],
      status: "streaming",
      provider: "claude",
      createdAt: new Date().toISOString(),
    });
    database.addFragment("message-2", 1, "hello");
    database.updateMessage(
      "message-2",
      [{ type: "text", text: "hello" }],
      "completed",
    );

    expect(database.getConversation("conversation-2")?.messages[0]?.status).toBe(
      "completed",
    );
  });

  it("keeps transfer preparation conversations out of the main list", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "visible",
      title: "Visible",
      provider: "chatgpt",
    });
    database.createConversation({
      id: "hidden",
      title: "Preparation",
      provider: "claude",
      hidden: true,
    });

    expect(database.listConversations().map((item) => item.id)).toEqual([
      "visible",
    ]);
    expect(database.listConversations(true)).toHaveLength(2);
  });
});
