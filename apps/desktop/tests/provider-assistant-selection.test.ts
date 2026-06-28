// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pickAssistantElement } from "../src/provider-assistant-selection";

describe("provider-assistant-selection", () => {
  it("prefers qianwen answer wrappers over nested markdown fragments", () => {
    document.body.innerHTML = `
      <div class="qk-markdown">nested text</div>
      <div class="message-select-wrapper-answer-123">final answer</div>
    `;

    const selected = pickAssistantElement(
      "qianwen",
      ["div.qk-markdown", "div[class*='message-select-wrapper-answer']"],
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)),
    );

    expect(selected?.textContent).toContain("final answer");
  });

  it("avoids selecting elements inside the composer", () => {
    document.body.innerHTML = `
      <div id="input-engine-container">
        <div data-copy-telemetry="right_click_copy">draft</div>
      </div>
      <div data-copy-telemetry="right_click_copy">assistant reply</div>
    `;

    const selected = pickAssistantElement(
      "doubao",
      ["[data-copy-telemetry='right_click_copy']"],
      (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)),
    );

    expect(selected?.textContent).toContain("assistant reply");
  });
});
