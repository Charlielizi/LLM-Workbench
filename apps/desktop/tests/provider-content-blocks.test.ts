// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickAssistantElement } from "../src/provider-assistant-selection";
import { buildAssistantContentBlocks } from "../src/provider-content-blocks";

function fixture(name: string): string {
  return readFileSync(
    path.join(import.meta.dirname, "fixtures", name),
    "utf8",
  );
}

describe("provider content blocks", () => {
  it("extracts structured content from a real-ish doubao answer", () => {
    document.body.innerHTML = fixture("doubao-assistant.html");
    const root = pickAssistantElement(
      "doubao",
      [
        "[data-message-id]",
        "[data-copy-telemetry='right_click_copy']",
        "[class*='markdown-body']",
      ],
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)),
    );

    const content = buildAssistantContentBlocks(
      root,
      "豆包回答正文",
      "<div><p>豆包回答正文</p></div>",
    );

    expect(content[0]).toEqual({ type: "text", text: "豆包回答正文" });
    expect(content).toContainEqual({
      type: "image",
      src: "https://cdn.example.com/doubao-chart.png",
      alt: "chart",
      title: undefined,
    });
    expect(content).toContainEqual({
      type: "math",
      tex: "E = mc^2",
      display: false,
      source: "katex",
    });
    expect(content.at(-1)).toEqual({
      type: "html",
      kind: "provider-assistant",
      html: "<div><p>豆包回答正文</p></div>",
    });
  });

  it("prefers qianwen answer wrappers and extracts mathjax content", () => {
    document.body.innerHTML = fixture("qianwen-assistant.html");
    const root = pickAssistantElement(
      "qianwen",
      ["div.qk-markdown", "div[class*='message-select-wrapper-answer']"],
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)),
    );

    expect(root?.textContent).toContain("千问最终回答");
    const content = buildAssistantContentBlocks(root, "千问最终回答");

    expect(content).toContainEqual({
      type: "image",
      src: "https://cdn.example.com/qianwen-diagram.png",
      alt: "diagram",
      title: undefined,
    });
    expect(content).toContainEqual({
      type: "math",
      tex: "\\int_0^1 x^2 dx",
      display: true,
      source: "mathjax",
    });
  });

  it("extracts formula content from a real-ish hunyuan answer", () => {
    document.body.innerHTML = fixture("hunyuan-assistant.html");
    const root = pickAssistantElement(
      "hunyuan",
      ["[class*='agent-message']", "[class*='markdown-body']"],
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)),
    );

    const content = buildAssistantContentBlocks(root, "元宝回答");
    expect(content).toContainEqual({
      type: "math",
      tex: "a^2+b^2=c^2",
      display: true,
      source: "mathjax",
    });
  });
});
