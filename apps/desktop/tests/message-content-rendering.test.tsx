// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@aihub/core";
import { MessageContent } from "../src/renderer/components/chat/MessageContent";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("MessageContent rich rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a structured provider image once and preserves provider math", async () => {
    const imageUrl = "https://cdn.example.com/generated-avatar.png";
    const providerHtml = [
      "<p>Rich provider answer</p>",
      `<img src="${imageUrl}" alt="duplicate provider image">`,
      "<span class='katex'>",
      "<annotation encoding='application/x-tex'>E = mc^2</annotation>",
      "</span>",
    ].join("");

    await renderMessage({
      content: [
        { type: "text", text: "Rich provider answer" },
        { type: "image", src: imageUrl, alt: "generated avatar" },
        {
          type: "math",
          tex: "E = mc^2",
          display: false,
          source: "katex",
        },
        { type: "html", kind: "provider-assistant", html: providerHtml },
      ],
      providerHtml,
    });

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toBe(imageUrl);
    expect(images[0]?.getAttribute("alt")).toBe("generated avatar");
    expect(container.querySelector(".aihub-provider-math .katex")).not.toBeNull();
    expect(container.textContent).toContain("Rich provider answer");
  });

  it("renders a structured display formula through KaTeX", async () => {
    await renderMessage({
      content: [
        { type: "text", text: "Quadratic formula" },
        {
          type: "math",
          tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
          display: true,
          source: "katex",
        },
      ],
    });

    expect(container.querySelector(".katex-display .katex")).not.toBeNull();
    expect(container.textContent).toContain("Quadratic formula");
    expect(container.textContent).toContain("x");
  });

  it("renders a Markdown image from a text-only response", async () => {
    await renderMessage({
      content: [
        {
          type: "text",
          text: "![generated chart](https://cdn.example.com/chart.png)",
        },
      ],
    });

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      "https://cdn.example.com/chart.png",
    );
    expect(image?.getAttribute("alt")).toBe("generated chart");
  });

  async function renderMessage(
    overrides: Pick<NormalizedMessage, "content" | "providerHtml">,
  ): Promise<void> {
    const message: NormalizedMessage = {
      id: "assistant-rich-content",
      conversationId: "conversation-rich-content",
      role: "assistant",
      content: overrides.content,
      providerHtml: overrides.providerHtml,
      status: "completed",
      provider: "doubao",
      createdAt: "2026-07-23T00:00:00.000Z",
    };

    await act(async () => {
      root.render(<MessageContent message={message} />);
      await Promise.resolve();
    });
  }
});
