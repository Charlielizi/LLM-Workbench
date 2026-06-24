import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { firstMatch, providerDefinitions } from "../src";
import { PROVIDER_IDS } from "@aihub/core";

describe("semantic selector fallbacks", () => {
  it("finds ChatGPT composer by stable id", () => {
    const dom = new JSDOM("<textarea id='prompt-textarea'></textarea>");
    expect(
      firstMatch(
        dom.window.document,
        providerDefinitions.chatgpt.composerSelectors,
      )?.id,
    ).toBe("prompt-textarea");
  });

  it("finds Claude composer by accessible role", () => {
    const dom = new JSDOM(
      "<div contenteditable='true' role='textbox'></div>",
    );
    expect(
      firstMatch(
        dom.window.document,
        providerDefinitions.claude.composerSelectors,
      ),
    ).not.toBeNull();
  });

  it("defines an isolated website adapter for every supported provider", () => {
    expect(Object.keys(providerDefinitions).sort()).toEqual(
      [...PROVIDER_IDS].sort(),
    );
    for (const provider of PROVIDER_IDS) {
      const definition = providerDefinitions[provider];
      expect(new URL(definition.loginUrl).protocol).toBe("https:");
      expect(definition.composerSelectors.length).toBeGreaterThan(0);
      expect(definition.submitSelectors.length).toBeGreaterThan(0);
      expect(definition.assistantMessageSelectors.length).toBeGreaterThan(0);
    }
  });

  it("prefers a usable composer over stale login elements", () => {
    const dom = new JSDOM(`
      <button class="login-entry" hidden>登录</button>
      <div contenteditable="true" role="textbox"></div>
    `);
    expect(
      firstMatch(
        dom.window.document,
        providerDefinitions.doubao.composerSelectors,
      ),
    ).not.toBeNull();
  });

  it("supports Doubao's input-engine rich text composer", () => {
    const dom = new JSDOM(`
      <div id="input-engine-container">
        <div contenteditable="true" data-placeholder="发消息或按住空格说话..."></div>
      </div>
    `);
    expect(
      firstMatch(
        dom.window.document,
        providerDefinitions.doubao.composerSelectors,
      ),
    ).not.toBeNull();
    expect(providerDefinitions.doubao.submitWithEnter).toBe(true);
    expect(
      providerDefinitions.doubao.conversationDocumentSelectors,
    ).toContain("main");
  });
});
