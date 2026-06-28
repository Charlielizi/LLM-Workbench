// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cloneElementWithShadow } from "../src/provider-dom-clone";

describe("provider-dom-clone", () => {
  it("clones shadow-root content into the returned subtree", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<div><img src=\"https://example.com/a.png\"><p>shadow image</p></div>";

    const clone = cloneElementWithShadow(host);

    expect(clone.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
    expect(clone.textContent).toContain("shadow image");
  });
});
