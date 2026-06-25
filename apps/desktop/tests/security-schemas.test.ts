import { describe, expect, it } from "vitest";
import {
  conversationPinSchema,
  conversationRenameSchema,
  conversationSearchSchema,
  messageDeleteSchema,
  messageEditResendSchema,
  comparisonCreateSchema,
  providerLayoutSchema,
  systemPromptCreateSchema,
  transferPreviewSchema,
  appSettingsSchema,
  conversationBulkActionSchema,
  conversationSetDocumentsSchema,
  tagCreateSchema,
  providerEventSchema,
  sendMessageSchema,
  transferConfirmSchema,
} from "@aihub/core";

describe("trusted IPC schemas", () => {
  it("rejects unknown providers and empty messages", () => {
    expect(() =>
      sendMessageSchema.parse({
        provider: "unknown",
        conversationId: "conversation",
        text: "hello",
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: " ",
      }),
    ).toThrow();
  });

  it("accepts all supported Chinese provider ids", () => {
    for (const provider of [
      "doubao",
      "kimi",
      "deepseek",
      "hunyuan",
      "qianwen",
    ]) {
      expect(
        sendMessageSchema.parse({
          provider,
          conversationId: "conversation",
          text: "hello",
        }).provider,
      ).toBe(provider);
    }
  });

  it("accepts attachment-only and multimodal send requests", () => {
    const attachment = {
      localPath: "C:\\Users\\li\\Pictures\\sample.png",
      name: "sample.png",
      kind: "image",
      sizeBytes: 1024,
    };
    expect(
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [attachment],
        modes: ["reasoning", "web-search"],
        model: "GPT-5",
      }).attachments,
    ).toEqual([attachment]);
    expect(
      sendMessageSchema.parse({
        provider: "claude",
        conversationId: "conversation",
        text: "Analyze this image.",
        attachments: [attachment],
      }).text,
    ).toBe("Analyze this image.");
  });

  it("rejects empty sends and invalid multimodal metadata", () => {
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [],
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "hello",
        modes: ["unsupported-mode"],
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [{
          localPath: "",
          name: "sample.png",
          kind: "image",
          sizeBytes: -1,
        }],
      }),
    ).toThrow();
  });

  it("rejects arbitrary provider bridge messages", () => {
    expect(() =>
      providerEventSchema.parse({
        type: "execute-script",
        code: "require('fs')",
      }),
    ).toThrow();
  });

  it("accepts provider-completed messages with captured provider html", () => {
    const parsed = providerEventSchema.parse({
      type: "message.completed",
      message: {
        id: "message",
        conversationId: "conversation",
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
        providerHtml: "<div class='markdown'><p>Answer</p></div>",
        status: "completed",
        provider: "chatgpt",
        createdAt: new Date().toISOString(),
      },
    });

    expect(parsed.type).toBe("message.completed");
    if (parsed.type !== "message.completed") {
      throw new Error("Expected a completed provider event.");
    }
    expect(parsed.message.providerHtml).toContain("<p>Answer</p>");
  });

  it("accepts provider snapshot events with html", () => {
    const parsed = providerEventSchema.parse({
      type: "message.snapshot",
      messageId: "message",
      text: "partial answer",
      providerHtml: "<div><p>partial answer</p></div>",
    });

    expect(parsed.type).toBe("message.snapshot");
    if (parsed.type !== "message.snapshot") {
      throw new Error("Expected a snapshot provider event.");
    }
    expect(parsed.providerHtml).toContain("partial answer");
  });

  it("bounds transfer payload size", () => {
    expect(() =>
      transferConfirmSchema.parse({
        sourceConversationId: "conversation",
        markdown: "x".repeat(120_001),
      }),
    ).toThrow();
  });

  it("validates conversation management payloads", () => {
    expect(
      conversationSearchSchema.parse({ query: "database" }).query,
    ).toBe("database");
    expect(() =>
      conversationSearchSchema.parse({ query: "x".repeat(201) }),
    ).toThrow();
    expect(() =>
      conversationRenameSchema.parse({
        conversationId: "conversation",
        title: " ",
      }),
    ).toThrow();
    expect(
      conversationPinSchema.parse({
        conversationId: "conversation",
        pinned: true,
      }).pinned,
    ).toBe(true);
  });

  it("validates message mutation payloads", () => {
    expect(
      messageDeleteSchema.parse({
        conversationId: "conversation",
        messageId: "message",
      }).messageId,
    ).toBe("message");
    expect(() =>
      messageEditResendSchema.parse({
        conversationId: "conversation",
        messageId: "message",
        text: " ",
      }),
    ).toThrow();
  });

  it("validates provider layout, prompts, transfers, and comparisons", () => {
    expect(providerLayoutSchema.parse({ width: 520 }).width).toBe(520);
    expect(() => providerLayoutSchema.parse({ width: 100 })).toThrow();
    expect(
      systemPromptCreateSchema.parse({
        name: "Concise",
        content: "Be concise.",
      }).name,
    ).toBe("Concise");
    expect(
      transferPreviewSchema.parse({
        sourceConversationId: "source",
        targetProvider: "doubao",
      }).targetProvider,
    ).toBe("doubao");
    expect(() =>
      comparisonCreateSchema.parse({
        providers: ["chatgpt", "chatgpt"],
      }),
    ).toThrow();
  });

  it("validates knowledge, organization, and settings payloads", () => {
    expect(
      conversationSetDocumentsSchema.parse({
        conversationId: "conversation",
        documentIds: ["document"],
      }).documentIds,
    ).toEqual(["document"]);
    expect(
      tagCreateSchema.parse({ name: "Research", color: "#7ce6ae" }).color,
    ).toBe("#7ce6ae");
    expect(() =>
      conversationBulkActionSchema.parse({
        action: "migrate",
        conversationIds: [],
        targetProvider: "claude",
      }),
    ).toThrow();
    expect(appSettingsSchema.parse({ theme: "system" }).theme).toBe("system");
  });

});
