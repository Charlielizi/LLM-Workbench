// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderProviderHtml } from "../src/renderer/utils/provider-html";

describe("renderProviderHtml", () => {
  it("suppresses inline images when structured image blocks render them", () => {
    const html = renderProviderHtml(
      '<p>answer</p><picture><img src="https://example.com/image.png"></picture>',
      true,
    );
    expect(html).toContain("answer");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<picture");
  });

  it("removes unsafe tags and event handlers", () => {
    const html = renderProviderHtml(
      "<div onclick='alert(1)'><script>alert(1)</script><a href='javascript:alert(1)'>x</a></div>",
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("javascript:");
  });

  it("renders katex and mathjax containers into provider math html", () => {
    const html = renderProviderHtml(
      "<div><span class='katex'><annotation encoding='application/x-tex'>x^2+y^2</annotation></span></div>",
    );

    expect(html).toContain("aihub-provider-math");
    expect(html).toContain("katex");
    expect(html).toContain("x^2+y^2");
  });

  it("removes inline layout styles that can create blank gaps", () => {
    const html = renderProviderHtml(
      "<div><p>Line 1</p><div style='height:800px'></div><p>Line 2</p></div>",
    );

    expect(html).not.toContain("height:800px");
    expect(html).toContain("Line 1");
    expect(html).toContain("Line 2");
  });
});
