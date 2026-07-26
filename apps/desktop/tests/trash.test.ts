import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/main/database";

afterEach(() => vi.useRealTimers());

describe("AppDatabase Trash", () => {
  it("restores soft-deleted entities with their relationships", () => {
    const database = new AppDatabase(":memory:");
    try {
      const now = new Date().toISOString();
      database.createFolder({
        id: "folder-1",
        name: "Research",
        createdAt: now,
      });
      database.createTag({
        id: "tag-1",
        name: "Important",
        color: "#ff0000",
        createdAt: now,
      });
      database.createSystemPrompt({
        id: "prompt-1",
        name: "Reviewer",
        content: "Review carefully.",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      database.addDocument({
        id: "document-1",
        name: "Evidence.txt",
        filePath: "C:\\source\\Evidence.txt",
        content: "Evidence",
        mimeType: "text/plain",
        sizeBytes: 8,
        createdAt: now,
        updatedAt: now,
      });
      database.createConversation({
        id: "conversation-1",
        title: "Recoverable",
        provider: "chatgpt",
        externalId: "https://chatgpt.com/c/recoverable",
      });
      database.setConversationFolder("conversation-1", "folder-1");
      database.setConversationTags("conversation-1", ["tag-1"]);
      database.setConversationSystemPrompt("conversation-1", "prompt-1");
      database.setConversationDocuments("conversation-1", ["document-1"]);

      database.deleteFolder("folder-1");
      database.deleteTag("tag-1");
      database.deleteSystemPrompt("prompt-1");
      database.removeDocument("document-1");
      expect(database.getConversation("conversation-1")).toMatchObject({
        folderId: undefined,
        tagIds: [],
        systemPromptId: undefined,
        documentIds: [],
      });
      database.deleteConversation("conversation-1");

      expect(database.getConversation("conversation-1")).toBeUndefined();
      expect(database.listFolders()).toEqual([]);
      expect(database.listTags()).toEqual([]);
      expect(database.listSystemPrompts()).toEqual([]);
      expect(database.listDocuments()).toEqual([]);
      expect(database.listTrash(30)).toHaveLength(5);

      for (const item of database.listTrash(30)) {
        database.restoreTrash(item.type, item.id);
      }

      const restored = database.getConversation("conversation-1");
      expect(restored).toMatchObject({
        folderId: "folder-1",
        tagIds: ["tag-1"],
        systemPromptId: "prompt-1",
        documentIds: ["document-1"],
      });
      expect(database.listFolders()).toHaveLength(1);
      expect(database.listTags()).toHaveLength(1);
      expect(database.listSystemPrompts()).toHaveLength(1);
      expect(database.listDocuments()).toHaveLength(1);
      expect(
        database.isWebConversationDeleted(
          "chatgpt",
          "https://chatgpt.com/c/recoverable",
        ),
      ).toBe(false);
    } finally {
      database.close();
    }
  });

  it("keeps a website tombstone after permanent purge until re-import is allowed", () => {
    const database = new AppDatabase(":memory:");
    try {
      const externalId = "https://chatgpt.com/c/deleted";
      database.createConversation({
        id: "deleted-conversation",
        title: "Do not resurrect",
        provider: "chatgpt",
        externalId,
      });
      database.deleteConversation("deleted-conversation");
      expect(database.isWebConversationDeleted("chatgpt", externalId)).toBe(
        true,
      );

      database.purgeTrash("conversation", "deleted-conversation");
      expect(database.getConversation("deleted-conversation")).toBeUndefined();
      expect(database.isWebConversationDeleted("chatgpt", externalId)).toBe(
        true,
      );

      database.allowWebConversationReimport("chatgpt", externalId);
      expect(database.isWebConversationDeleted("chatgpt", externalId)).toBe(
        false,
      );
    } finally {
      database.close();
    }
  });

  it("purges expired Trash content while retaining website tombstones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const database = new AppDatabase(":memory:");
    try {
      const externalId = "https://chatgpt.com/c/expired";
      database.createConversation({
        id: "expired-conversation",
        title: "Expired",
        provider: "chatgpt",
        externalId,
      });
      database.deleteConversation("expired-conversation");
      vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));

      expect(database.purgeExpiredTrash(7)).toBe(1);
      expect(database.listTrash(7)).toEqual([]);
      expect(database.isWebConversationDeleted("chatgpt", externalId)).toBe(
        true,
      );
    } finally {
      database.close();
    }
  });
});
