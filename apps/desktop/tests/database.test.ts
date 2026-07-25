import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/main/database";

let database: AppDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("AppDatabase", () => {
  it("upserts imported web conversations and deterministic messages", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "web-conversation",
      title: "Original title",
      provider: "doubao",
      externalId: "https://www.doubao.com/chat/external-1",
    });
    expect(database.getConversationByExternalId(
      "doubao",
      "https://www.doubao.com/chat/external-1",
    )?.id).toBe("web-conversation");

    database.updateWebConversation(
      "web-conversation",
      "Updated title",
      "https://www.doubao.com/chat/external-1",
    );
    const message = {
      id: "web-message-key",
      conversationId: "web-conversation",
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "First snapshot" }],
      status: "completed" as const,
      provider: "doubao" as const,
      createdAt: new Date().toISOString(),
    };
    database.upsertMessage(message);
    database.upsertMessage({
      ...message,
      content: [{ type: "text", text: "Updated snapshot" }],
    });

    const restored = database.getConversation("web-conversation");
    expect(restored?.title).toBe("Updated title");
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0]?.content[0]).toEqual({
      type: "text",
      text: "Updated snapshot",
    });
  });

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

  it("persists provider failure origin metadata", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "conversation-failure-origin",
      title: "Failure origin",
      provider: "deepseek",
    });
    database.addMessage({
      id: "message-failure-origin",
      conversationId: "conversation-failure-origin",
      role: "user",
      content: [{ type: "text", text: "Retry this." }],
      status: "failed",
      statusPhase: "failed",
      errorCode: "provider_external_failure",
      failureOrigin: "external",
      provider: "deepseek",
      createdAt: new Date().toISOString(),
    });

    expect(database.getMessage("message-failure-origin")).toMatchObject({
      errorCode: "provider_external_failure",
      failureOrigin: "external",
    });
  });

  it("stores recent adapter events with basic secret redaction", () => {
    database = new AppDatabase(":memory:");

    database.logAdapterEvent(
      "chatgpt",
      "provider.debug-snapshot",
      "user@example.com token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN",
    );
    database.logAdapterEvent("claude", "provider.network-idle", "ignored");

    const events = database.listAdapterEvents();
    expect(events).toHaveLength(2);
    const chatgptEvents = database.listAdapterEvents("chatgpt");
    expect(chatgptEvents).toHaveLength(1);
    expect(chatgptEvents[0]).toMatchObject({
      provider: "chatgpt",
      type: "provider.debug-snapshot",
    });
    expect(chatgptEvents[0]?.detail).toContain("[email]");
    expect(chatgptEvents[0]?.detail).toContain("[secret]");
  });

  it("filters adapter events by created_at when a lower bound is provided", () => {
    database = new AppDatabase(":memory:");

    database.logAdapterEvent("chatgpt", "message.status", "{\"phase\":\"checking-auth\"}");
    const firstEvent = database.listAdapterEvents("chatgpt", 10)[0];
    expect(firstEvent).toBeDefined();

    database.logAdapterEvent("chatgpt", "message.status", "{\"phase\":\"submitting\"}");
    const filtered = database.listAdapterEvents("chatgpt", 10, firstEvent?.createdAt);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((event) => event.type)).toEqual([
      "message.status",
      "message.status",
    ]);
    const afterFirst = database.listAdapterEvents(
      "chatgpt",
      10,
      "9999-12-31T23:59:59.999Z",
    );
    expect(afterFirst).toHaveLength(0);
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

  it("searches title and message content", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "searchable",
      title: "Release planning",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "search-message",
      conversationId: "searchable",
      role: "user",
      content: [{ type: "text", text: "Discuss the database migration." }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });

    expect(database.searchConversations("Release")[0]?.id).toBe("searchable");
    expect(database.searchConversations("migration")[0]?.id).toBe(
      "searchable",
    );
  });

  it("pins, renames, and deletes conversations", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "managed",
      title: "Original",
      provider: "claude",
    });

    database.setConversationPinned("managed", true);
    database.renameConversation("managed", "Renamed");
    expect(database.getConversation("managed")).toMatchObject({
      title: "Renamed",
      pinned: true,
    });

    database.deleteConversation("managed");
    expect(database.getConversation("managed")).toBeUndefined();
  });

  it("deletes a message and all later messages for edit-resend", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "editable",
      title: "Editable",
      provider: "chatgpt",
    });
    for (const [index, role] of ["user", "assistant", "user"] .entries()) {
      database.addMessage({
        id: `edit-message-${index}`,
        conversationId: "editable",
        role: role as "user" | "assistant",
        content: [{ type: "text", text: `message ${index}` }],
        status: "completed",
        provider: "chatgpt",
        createdAt: new Date(Date.now() + index).toISOString(),
      });
    }

    database.deleteMessagesFrom("editable", "edit-message-1");
    expect(
      database
        .getConversation("editable")
        ?.messages.map((message) => message.id),
    ).toEqual(["edit-message-0"]);
  });

  it("stores system prompts and resolves provider defaults", () => {
    database = new AppDatabase(":memory:");
    const now = new Date().toISOString();
    database.createSystemPrompt({
      id: "global-prompt",
      name: "Global",
      content: "Global instruction",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    database.createSystemPrompt({
      id: "claude-prompt",
      name: "Claude",
      content: "Claude instruction",
      provider: "claude",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(database.getDefaultSystemPrompt("chatgpt")?.id).toBe(
      "global-prompt",
    );
    expect(database.getDefaultSystemPrompt("claude")?.id).toBe(
      "claude-prompt",
    );
  });

  it("persists comparison sessions and participants", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "compare-a",
      title: "A",
      provider: "chatgpt",
    });
    database.createConversation({
      id: "compare-b",
      title: "B",
      provider: "claude",
    });
    const now = new Date().toISOString();
    database.createComparisonSession({
      id: "comparison",
      title: "Compare",
      participants: [
        { conversationId: "compare-a", provider: "chatgpt" },
        { conversationId: "compare-b", provider: "claude" },
      ],
      createdAt: now,
      updatedAt: now,
    });

    expect(database.getComparisonSession("comparison")?.participants).toHaveLength(
      2,
    );
  });

  it("stores knowledge documents, folders, tags, and settings", () => {
    database = new AppDatabase(":memory:");
    const conversation = database.createConversation({
      id: "organized",
      title: "Organized",
      provider: "chatgpt",
    });
    const now = new Date().toISOString();
    database.addDocument({
      id: "document",
      name: "notes.md",
      filePath: "C:\\notes.md",
      content: "Local knowledge content",
      mimeType: "text/markdown",
      sizeBytes: 100,
      createdAt: now,
      updatedAt: now,
    });
    database.createFolder({
      id: "folder",
      name: "Research",
      createdAt: now,
    });
    database.createTag({
      id: "tag",
      name: "Important",
      color: "#7ce6ae",
      createdAt: now,
    });
    database.setConversationDocuments(conversation.id, ["document"]);
    database.setConversationFolder(conversation.id, "folder");
    database.setConversationTags(conversation.id, ["tag"]);
    database.setSettings({ theme: "dark", sidebarWidth: 300 });

    expect(database.getConversation(conversation.id)).toMatchObject({
      documentIds: ["document"],
      folderId: "folder",
      tagIds: ["tag"],
    });
    expect(database.listDocuments()[0]?.name).toBe("notes.md");
    expect(database.getSettings()).toMatchObject({
      theme: "dark",
      sidebarWidth: 300,
    });
  });

  it("uses FTS5 for message content search", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "fts-conversation",
      title: "Unrelated title",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "fts-message",
      conversationId: "fts-conversation",
      role: "user",
      content: [{ type: "text", text: "electrochemical impedance" }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    expect(database.searchConversations("electrochemical")[0]?.id).toBe(
      "fts-conversation",
    );
  });

  it("persists provider html for assistant messages", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "html-conversation",
      title: "Provider HTML",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "html-message",
      conversationId: "html-conversation",
      role: "assistant",
      content: [{ type: "text", text: "Rendered answer" }],
      providerHtml: "<div class='markdown'><p><strong>Rendered answer</strong></p></div>",
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });

    expect(
      database.getConversation("html-conversation")?.messages[0]?.providerHtml,
    ).toContain("<strong>Rendered answer</strong>");
  });

  it("reconciles website messages with matching local messages", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "web-reconcile",
      title: "Reconcile",
      provider: "chatgpt",
      externalId: "https://chatgpt.com/c/reconcile",
    });
    database.addMessage({
      id: "local-user",
      conversationId: "web-reconcile",
      role: "user",
      content: [{ type: "text", text: "same prompt" }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });

    database.upsertWebsiteMessage({
      id: "remote-user",
      conversationId: "web-reconcile",
      provider: "chatgpt",
      remoteKey: "remote-key-1",
      sourceOrder: 0,
      role: "user",
      content: [{ type: "text", text: "same prompt" }],
      createdAt: new Date().toISOString(),
    });
    database.upsertWebsiteMessage({
      id: "another-remote-user",
      conversationId: "web-reconcile",
      provider: "chatgpt",
      remoteKey: "remote-key-1",
      sourceOrder: 0,
      role: "user",
      content: [{ type: "text", text: "same prompt updated" }],
      createdAt: new Date().toISOString(),
    });

    const messages = database.getConversation("web-reconcile")?.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.id).toBe("local-user");
    expect(messages?.[0]?.content).toEqual([
      { type: "text", text: "same prompt updated" },
    ]);
  });

  it("persists structured assistant content blocks", () => {
    database = new AppDatabase(":memory:");
    database.createConversation({
      id: "structured-conversation",
      title: "Structured",
      provider: "chatgpt",
    });
    database.addMessage({
      id: "structured-message",
      conversationId: "structured-conversation",
      role: "assistant",
      content: [
        { type: "text", text: "Rendered answer" },
        { type: "image", src: "https://example.com/chart.png", alt: "chart" },
        {
          type: "math",
          tex: "x^2+y^2",
          display: false,
          source: "katex",
        },
        {
          type: "html",
          kind: "provider-assistant",
          html: "<div><p>Rendered answer</p></div>",
        },
      ],
      providerHtml: "<div><p>Rendered answer</p></div>",
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });

    expect(
      database.getConversation("structured-conversation")?.messages[0]?.content,
    ).toContainEqual({
      type: "math",
      tex: "x^2+y^2",
      display: false,
      source: "katex",
    });
  });
});
