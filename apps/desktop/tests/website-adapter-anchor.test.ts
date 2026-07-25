// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebsiteAdapter } from "@aihub/adapters";

describe("website adapter anchor binding", () => {
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

  it("binds the assistant message that appears after the captured anchor", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant">old answer</div>
        <form>
          <textarea id="prompt-textarea"></textarea>
          <button data-testid="send-button">Send</button>
        </form>
      </main>
    `;
    const adapter = createWebsiteAdapter("chatgpt");
    const anchor = adapter.captureAnchor();

    document.querySelector("main")!.insertAdjacentHTML(
      "beforeend",
      `<div data-message-author-role="assistant">new answer</div>`,
    );

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(binding?.element.textContent).toContain("new answer");
    expect(binding?.fallbackUsed).toBe(false);
  });

  it("falls back to the latest visible assistant when no anchor match is available", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant">first answer</div>
        <div data-message-author-role="assistant">latest answer</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("chatgpt");
    const binding = adapter.fallbackAssistant();

    expect(binding?.element.textContent).toContain("latest answer");
    expect(binding?.fallbackUsed).toBe(true);
  });

  it("relocates the anchor by signature after the page rerenders existing turns", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="a1">old answer</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("chatgpt");
    const anchor = adapter.captureAnchor();

    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="a0">inserted older answer</div>
        <div data-message-author-role="assistant" data-turn-id="a1">old answer</div>
        <div data-message-author-role="assistant" data-turn-id="a2">new answer</div>
      </main>
    `;

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(binding?.element.textContent).toContain("new answer");
  });

  it("inserts prompt text through the adapter into textareas", async () => {
    document.body.innerHTML = `<textarea id="prompt-textarea"></textarea>`;
    const adapter = createWebsiteAdapter("chatgpt");
    const composer = adapter.findComposer();

    expect(composer).toBeInstanceOf(HTMLTextAreaElement);
    await expect(adapter.insertPrompt(composer!, "hello from adapter")).resolves.toBe(true);
    expect((composer as HTMLTextAreaElement).value).toBe("hello from adapter");
  });

  it("prefers qianwen answer wrappers over nested markdown fragments", () => {
    document.body.innerHTML = `
      <main>
        <div class="qk-markdown">nested fragment</div>
        <div class="message-select-wrapper-answer-abc">outer answer</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("qianwen");

    expect(adapter.fallbackAssistant()?.element.textContent).toContain("outer answer");
  });

  it("prefers doubao message containers over markdown fragments", () => {
    document.body.innerHTML = `
      <main>
        <div class="flow-markdown-body">nested markdown</div>
        <div data-message-id="m1" class="assistant-message">outer doubao answer</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("doubao");

    expect(adapter.fallbackAssistant()?.element.textContent).toContain("outer doubao answer");
  });

  it("does not bind a doubao user bubble while the assistant placeholder is empty", () => {
    document.body.innerHTML = `
      <div data-target-id="message-box-target-id">
        <div data-message-id="user-1" class="flex w-full justify-end">
          <div data-container-type="block-v2">
            <div class="md-box-root">long user prompt</div>
          </div>
        </div>
      </div>
      <div data-target-id="message-box-target-id">
        <div class="relative grid w-full">
          <div data-container-type="box" class="loading-container"></div>
        </div>
      </div>
    `;
    const adapter = createWebsiteAdapter("doubao");
    const anchor = adapter.captureAnchor();

    expect(adapter.findAssistantAfterAnchor(anchor)).toBeNull();

    document.querySelector(".relative.grid")!.innerHTML = `
      <div data-message-id="assistant-1">
        <div data-container-type="block-v2">
          <div class="md-box-root">real assistant answer</div>
        </div>
      </div>
    `;

    expect(adapter.findAssistantAfterAnchor(anchor)?.element.textContent).toContain(
      "real assistant answer",
    );
  });

  it("ignores user turns even when broad provider selectors match them", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-id="u1" class="justify-end user-message">user question</div>
        <div data-message-id="a1" class="assistant-message">assistant answer</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("doubao");

    expect(adapter.fallbackAssistant()?.element.textContent).toContain("assistant answer");
  });

  it("ignores recommendation and prompt cards when selecting latest assistant", () => {
    document.body.innerHTML = `
      <main>
        <div class="message-select-wrapper-answer-abc">real qianwen answer</div>
        <div class="chat-recommend-card qk-markdown">recommended prompt card</div>
        <div data-card-type="suggestion" class="answer-common-card">try this next</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("qianwen");

    expect(adapter.fallbackAssistant()?.element.textContent).toContain("real qianwen answer");
  });

  it("ignores assistant toolbar actions after an answer", () => {
    document.body.innerHTML = `
      <main>
        <div class="agent-message markdown-body">hunyuan answer</div>
        <div class="agent-message-action toolbar">copy share feedback</div>
      </main>
    `;
    const adapter = createWebsiteAdapter("hunyuan");

    expect(adapter.fallbackAssistant()?.element.textContent).toContain("hunyuan answer");
  });

  it("extracts doubao assistant text from the content root instead of wrapper actions", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-id="a1" class="assistant-message">
          <div class="flow-markdown-body">doubao answer body</div>
          <div class="message-action toolbar">copy share retry</div>
        </div>
      </main>
    `;
    const adapter = createWebsiteAdapter("doubao");
    const assistant = adapter.fallbackAssistant()?.element;

    expect(adapter.extractText(assistant!)).toBe("doubao answer body");
  });

  it("extracts qianwen assistant text from the answer card instead of wrapper actions", () => {
    document.body.innerHTML = `
      <main>
        <div class="assistant-shell">
          <div class="message-select-wrapper-answer-abc">qianwen answer body</div>
          <div class="chat-recommend-card toolbar">copy share regenerate</div>
        </div>
      </main>
    `;
    const adapter = createWebsiteAdapter("qianwen");
    const assistant = adapter.fallbackAssistant()?.element;

    expect(adapter.extractText(assistant!)).toBe("qianwen answer body");
  });

  it("extracts hunyuan assistant text from markdown content instead of wrapper actions", () => {
    document.body.innerHTML = `
      <main>
        <div class="agent-message-shell">
          <div class="markdown-body">hunyuan answer body</div>
          <div class="agent-message-action toolbar">copy share feedback</div>
        </div>
      </main>
    `;
    const adapter = createWebsiteAdapter("hunyuan");
    const assistant = adapter.fallbackAssistant()?.element;

    expect(adapter.extractText(assistant!)).toBe("hunyuan answer body");
  });
});
