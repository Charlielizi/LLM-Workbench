// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { plainTextWithShadow } from "../src/provider-dom-text";

describe("provider-dom-text", () => {
  it("includes text rendered inside shadow roots", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<article><p>shadow answer</p></article>";
    document.body.append(host);

    expect(plainTextWithShadow(document.body)).toContain("shadow answer");
  });

  it("ignores dropzone overlay text from the composer area", () => {
    document.body.innerHTML = `
      <main>
        <div class="answer">正常回答第一段</div>
        <div class="absolute left-0 top-0 right-0 bottom-0">
          在此处拖放文件 文件数量：最多 50 个
        </div>
        <div class="answer">正常回答第二段</div>
      </main>
    `;

    const text = plainTextWithShadow(document.body);

    expect(text).toContain("正常回答第一段");
    expect(text).toContain("正常回答第二段");
    expect(text).not.toContain("在此处拖放文件");
  });
});
