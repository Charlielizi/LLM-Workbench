// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderProviderHtml } from "../src/renderer/utils/provider-html";

describe("renderProviderHtml", () => {
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
});
