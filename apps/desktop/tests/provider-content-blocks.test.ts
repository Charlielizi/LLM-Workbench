// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWebsiteAdapter } from "@aihub/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

function fixture(name: string): string {
  return readFileSync(
    path.join(import.meta.dirname, "fixtures", name),
    "utf8",
  );
}

describe("provider content blocks", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 24,
      top: 0,
      right: 100,
      bottom: 24,
      left: 0,
      toJSON: () => ({}),
    });
  });

  it("extracts structured content from a real-ish doubao answer", () => {
    document.body.innerHTML = fixture("doubao-assistant.html");
    const adapter = createWebsiteAdapter("doubao");
    const root = adapter.fallbackAssistant()?.element;

    const content = adapter.extractContentBlocks(
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
    const adapter = createWebsiteAdapter("qianwen");
    const root = adapter.fallbackAssistant()?.element;

    expect(root?.textContent).toContain("千问最终回答");
    const content = adapter.extractContentBlocks(root, "千问最终回答");

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
    const adapter = createWebsiteAdapter("hunyuan");
    const root = adapter.fallbackAssistant()?.element;

    const content = adapter.extractContentBlocks(root, "元宝回答");
    expect(content).toContainEqual({
      type: "math",
      tex: "a^2+b^2=c^2",
      display: true,
      source: "mathjax",
    });
  });

  it("extracts lazy provider images while excluding UI images", () => {
    document.body.innerHTML = `
      <main><div data-role="assistant" data-turn-id="images">
        <img class="avatar" src="/avatar/user.png" width="32" height="32" alt="avatar" />
        <picture>
          <source srcset="/generated-small.webp 480w, /generated-large.webp 1280w" />
          <img data-src="/generated-fallback.png" alt="generated chart" width="1024" height="768" />
        </picture>
      </div></main>`;
    const adapter = createWebsiteAdapter("kimi");
    const content = adapter.extractContentBlocks(
      document.querySelector<HTMLElement>("[data-role='assistant']") ?? undefined,
      "image answer",
    );

    expect(content.filter((block) => block.type === "image")).toEqual([
      expect.objectContaining({
        type: "image",
        src: "http://localhost:3000/generated-fallback.png",
        alt: "generated chart",
      }),
    ]);
  });
});
