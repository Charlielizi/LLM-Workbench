import { describe, expect, it } from "vitest";
import {
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

  it("rejects arbitrary provider bridge messages", () => {
    expect(() =>
      providerEventSchema.parse({
        type: "execute-script",
        code: "require('fs')",
      }),
    ).toThrow();
  });

  it("bounds transfer payload size", () => {
    expect(() =>
      transferConfirmSchema.parse({
        sourceConversationId: "conversation",
        markdown: "x".repeat(120_001),
      }),
    ).toThrow();
  });

});
