import { describe, expect, it } from "vitest";
import { providerDefinitions } from "../src";

describe("conversationUrlPattern", () => {
  it("every provider defines a conversation URL pattern", () => {
    for (const [id, def] of Object.entries(providerDefinitions)) {
      expect(def.conversationUrlPattern, `${id} missing pattern`).toBeDefined();
    }
  });

  const cases: [string, string, string][] = [
    ["chatgpt", "https://chatgpt.com/c/abc-123-def", "abc-123-def"],
    ["claude", "https://claude.ai/chat/550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440000"],
    ["doubao", "https://www.doubao.com/chat/abc123xyz", "abc123xyz"],
    ["kimi", "https://www.kimi.com/chat/conv_123", "conv_123"],
    ["deepseek", "https://chat.deepseek.com/?q=conversation-id-123", "conversation-id-123"],
    ["deepseek", "https://chat.deepseek.com/a/chat/s/conversation-id-456", "conversation-id-456"],
    ["hunyuan", "https://yuanbao.tencent.com/chat/abc123", "abc123"],
    ["qianwen", "https://www.qianwen.com/chat/conv_456", "conv_456"],
  ];

  for (const [provider, url, expectedId] of cases) {
    it(`${provider} extracts "${expectedId}" from ${url}`, () => {
      const def = providerDefinitions[provider as keyof typeof providerDefinitions];
      const match = def.conversationUrlPattern!.exec(url);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(expectedId);
    });
  }

  it("does not match new-conversation URLs", () => {
    const chatgpt = providerDefinitions.chatgpt;
    const match = chatgpt.conversationUrlPattern!.exec("https://chatgpt.com/");
    expect(match).toBeNull();
  });
});
