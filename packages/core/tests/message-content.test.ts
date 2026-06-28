import { describe, expect, it } from "vitest";
import { contentBlocksToText } from "../src/message-content";

describe("message-content", () => {
  it("downgrades structured blocks to plain text", () => {
    expect(contentBlocksToText([
      { type: "text", text: "Answer" },
      { type: "image", src: "https://example.com/image.png", alt: "chart" },
      { type: "math", tex: "x^2+y^2", display: false, source: "katex" },
    ])).toContain("![chart](https://example.com/image.png)");
  });

  it("uses html as a fallback when no more specific blocks exist", () => {
    expect(contentBlocksToText([
      {
        type: "html",
        kind: "provider-assistant",
        html: "<div><p>Rendered <strong>answer</strong></p></div>",
      },
    ])).toBe("Rendered answer");
  });
});
