import { describe, expect, it } from "vitest";
import type { AppDataExportV1 } from "@aihub/core";
import { AppDatabase } from "../src/main/database";

const timestamp = "2026-07-26T00:00:00.000Z";

function createPayload(): AppDataExportV1 {
  return {
    format: "aihub-data",
    version: 1,
    appVersion: "0.2.0",
    exportedAt: timestamp,
    folders: [
      {
        id: "folder-import",
        name: "Imported folder",
        createdAt: timestamp,
      },
    ],
    tags: [
      {
        id: "tag-import",
        name: "Imported tag",
        color: "#336699",
        createdAt: timestamp,
      },
    ],
    systemPrompts: [
      {
        id: "prompt-import",
        name: "Imported prompt",
        content: "Be concise.",
        isDefault: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    documents: [
      {
        id: "document-metadata-only",
        name: "private.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    conversations: [
      {
        id: "conversation-import",
        title: "Imported conversation",
        provider: "chatgpt",
        externalId: "https://chatgpt.com/c/imported",
        hidden: false,
        pinned: true,
        folderId: "folder-import",
        systemPromptId: "prompt-import",
        documentIds: ["document-metadata-only"],
        tagIds: ["tag-import"],
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "message-import",
            conversationId: "conversation-import",
            role: "assistant",
            content: [{ type: "text", text: "Imported answer" }],
            status: "streaming",
            provider: "chatgpt",
            createdAt: timestamp,
          },
        ],
      },
    ],
  };
}

describe("AppDatabase portable data import", () => {
  it("merges supported records atomically and ignores knowledge metadata", () => {
    const database = new AppDatabase(":memory:");
    try {
      const payload = createPayload();
      expect(database.analyzeDataImport(payload)).toEqual({
        conversationCount: 1,
        messageCount: 1,
        folderCount: 1,
        tagCount: 1,
        systemPromptCount: 1,
        skippedConflictCount: 0,
        ignoredKnowledgeDocumentCount: 1,
        adjustedDefaultPromptCount: 0,
      });

      expect(database.importAppData(payload)).toEqual({
        conversationCount: 1,
        messageCount: 1,
        folderCount: 1,
        tagCount: 1,
        systemPromptCount: 1,
        skippedConflictCount: 0,
        ignoredKnowledgeDocumentCount: 1,
        adjustedDefaultPromptCount: 0,
      });
      expect(database.getConversation("conversation-import")).toMatchObject({
        folderId: "folder-import",
        systemPromptId: "prompt-import",
        tagIds: ["tag-import"],
        documentIds: [],
        messages: [
          {
            id: "message-import",
            content: [{ type: "text", text: "Imported answer" }],
            status: "failed",
            statusPhase: "failed",
            errorCode: "imported_incomplete_message",
            failureOrigin: "client",
          },
        ],
      });
      expect(database.listDocuments()).toEqual([]);
      expect(database.searchConversations("Imported answer")).toHaveLength(1);

      expect(database.importAppData(payload)).toEqual({
        conversationCount: 0,
        messageCount: 0,
        folderCount: 0,
        tagCount: 0,
        systemPromptCount: 0,
        skippedConflictCount: 5,
        ignoredKnowledgeDocumentCount: 1,
        adjustedDefaultPromptCount: 0,
      });
    } finally {
      database.close();
    }
  });

  it("keeps the existing default prompt and imports a conflicting default as non-default", () => {
    const database = new AppDatabase(":memory:");
    try {
      database.createSystemPrompt({
        id: "existing-default",
        name: "Existing default",
        content: "Keep me.",
        provider: "chatgpt",
        isDefault: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const payload = createPayload();
      payload.systemPrompts[0] = {
        ...payload.systemPrompts[0]!,
        provider: "chatgpt",
        isDefault: true,
      };

      expect(database.analyzeDataImport(payload)).toMatchObject({
        systemPromptCount: 1,
        adjustedDefaultPromptCount: 1,
      });
      expect(database.importAppData(payload)).toMatchObject({
        systemPromptCount: 1,
        adjustedDefaultPromptCount: 1,
      });
      expect(database.getSystemPrompt("existing-default")?.isDefault).toBe(
        true,
      );
      expect(database.getSystemPrompt("prompt-import")?.isDefault).toBe(false);
      expect(database.getDefaultSystemPrompt("chatgpt")?.id).toBe(
        "existing-default",
      );
    } finally {
      database.close();
    }
  });

  it("treats an explicit portable import as consent to restore a tombstoned web conversation", () => {
    const database = new AppDatabase(":memory:");
    try {
      const payload = createPayload();
      database.createConversation({
        id: payload.conversations[0]!.id,
        title: "Deleted",
        provider: "chatgpt",
        externalId: payload.conversations[0]!.externalId,
      });
      database.deleteConversation(payload.conversations[0]!.id);
      database.purgeTrash("conversation", payload.conversations[0]!.id);
      expect(
        database.isWebConversationDeleted(
          "chatgpt",
          payload.conversations[0]!.externalId!,
        ),
      ).toBe(true);

      database.importAppData(payload);

      expect(
        database.isWebConversationDeleted(
          "chatgpt",
          payload.conversations[0]!.externalId!,
        ),
      ).toBe(false);
    } finally {
      database.close();
    }
  });
});
