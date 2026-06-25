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
      expect(definition.fileInputSelectors.length).toBeGreaterThan(0);
      expect(definition.attachmentControlLabels.length).toBeGreaterThan(0);
      expect(new Set(
        definition.modeDefinitions.map((mode) => mode.mode),
      ).size).toBe(definition.modeDefinitions.length);
      for (const mode of definition.modeDefinitions) {
        expect(mode.label.length).toBeGreaterThan(0);
        expect(mode.matchLabels.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses provider-specific website modes", () => {
    expect(
      providerDefinitions.deepseek.modeDefinitions.map((item) => item.mode),
    ).toEqual(["reasoning", "web-search"]);
    expect(
      providerDefinitions.chatgpt.modeDefinitions.map((item) => item.mode),
    ).toContain("image-generation");
    expect(
      providerDefinitions.kimi.modeDefinitions.map((item) => item.mode),
    ).toEqual([]);
    expect(
      providerDefinitions.doubao.modeDefinitions.find(
        (item) => item.mode === "reasoning",
      ),
    ).toMatchObject({
      label: "专家模式",
      matchLabels: ["专家"],
      openerLabels: ["快速", "专家"],
      disabledLabels: ["快速"],
    });
    expect(
      providerDefinitions.doubao.modeDefinitions.find(
        (item) => item.mode === "image-generation",
      )?.openerLabels,
    ).toContain("更多");
    expect(providerDefinitions.chatgpt.attachmentControlSelectors)
      .toContain("#composer-plus-btn");
    expect(providerDefinitions.chatgpt.modelControlSelectors)
      .toContain("[data-testid='model-switcher-dropdown-button']");
    expect(providerDefinitions.kimi.attachmentControlSelectors)
      .toContain(".toolkit-trigger-btn");
    expect(providerDefinitions.kimi.modelControlSelectors)
      .toContain(".current-model");
    expect(
      providerDefinitions.qianwen.modeDefinitions.map((item) => item.label),
    ).toEqual(["思考", "研究", "AI生图", "代码", "PPT创作"]);
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
