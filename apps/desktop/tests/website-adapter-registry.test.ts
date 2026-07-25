// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebsiteAdapter,
  providerDefinitions,
  websiteAdapterIds,
} from "@aihub/adapters";
import { PROVIDER_IDS } from "@aihub/core";

describe("website adapter registry", () => {
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

  it("registers one website adapter for every provider definition", () => {
    expect(websiteAdapterIds.sort()).toEqual([...PROVIDER_IDS].sort());
    for (const provider of PROVIDER_IDS) {
      const adapter = createWebsiteAdapter(provider);
      expect(adapter.provider).toBe(provider);
      expect(adapter.definition).toBe(providerDefinitions[provider]);
      expect(adapter.getCleanModeCss().length).toBeGreaterThan(0);
    }
  });

  it("keeps provider definitions available as the adapter fallback source", () => {
    for (const provider of PROVIDER_IDS) {
      const definition = providerDefinitions[provider];
      expect(definition.composerSelectors.length).toBeGreaterThan(0);
      expect(definition.submitSelectors.length || definition.submitWithEnter).toBeTruthy();
      expect(definition.assistantMessageSelectors.length).toBeGreaterThan(0);
    }
  });

  it("requires every provider adapter to expose target network idle signals", () => {
    for (const provider of PROVIDER_IDS) {
      const config = createWebsiteAdapter(provider).getNetworkMonitorConfig();
      expect(config, `${provider} is missing network monitor config`).not.toBeNull();
      expect([
        ...(config?.urlPatterns ?? []),
        ...(config?.urlPathEndsWith ?? []),
      ].length).toBeGreaterThan(0);
      expect(config?.silenceThresholdMs).toBeGreaterThanOrEqual(500);
      expect(config?.silenceThresholdMs).toBeLessThanOrEqual(10_000);
    }
  });

  it("exposes assistant text and html extraction on every provider adapter", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="a1">
          <p>answer</p>
          <button>copy</button>
        </div>
      </main>
    `;
    const element = document.querySelector<HTMLElement>("[data-turn-id='a1']");
    expect(element).not.toBeNull();
    for (const provider of PROVIDER_IDS) {
      const adapter = createWebsiteAdapter(provider);
      expect(adapter.extractText(element!)).toContain("answer");
      expect(adapter.extractHtml(element!)).toContain("<p>answer</p>");
      expect(adapter.extractHtml(element!)).not.toContain("<button");
    }
  });

  it("lets provider adapters override submit pending detection", () => {
    document.body.innerHTML = `
      <main>
        <button id="doubao" class="submit-loading">send</button>
        <button id="qianwen" class="btn-loading">send</button>
        <button id="hunyuan" class="button-loading">send</button>
      </main>
    `;

    expect(createWebsiteAdapter("doubao").isSubmitPending(
      document.getElementById("doubao") as HTMLElement,
    )).toBe(true);
    expect(createWebsiteAdapter("qianwen").isSubmitPending(
      document.getElementById("qianwen") as HTMLElement,
    )).toBe(true);
    expect(createWebsiteAdapter("hunyuan").isSubmitPending(
      document.getElementById("hunyuan") as HTMLElement,
    )).toBe(true);
  });

  it("treats a visible doubao thinking block outside the bound answer as generating", () => {
    document.body.innerHTML = `
      <div data-message-id="assistant-1">
        <div class="md-box-root">AIHUB</div>
      </div>
      <div data-plugin-identifier="Symbol(infra:receive-message-box:thinking)">
        <div class="loading-container-active">loading</div>
      </div>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      makeRect(0, 0, 100, 40),
    );

    expect(createWebsiteAdapter("doubao").isGenerating()).toBe(true);
  });

  it.each(["doubao", "hunyuan", "qianwen"] as const)(
    "does not infer %s login state while its composer and submit control are usable",
    (provider) => {
      document.body.innerHTML = `
        <main>
          <textarea placeholder="ask anything"></textarea>
          <button type="submit">send</button>
          <article>phone verification login guidance from a previous answer</article>
        </main>
      `;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        makeRect(0, 0, 100, 40),
      );

      expect(createWebsiteAdapter(provider).detectAuthInterruption()).toBeUndefined();
    },
  );

  it("does not expose Qianwen research progress as assistant answer text", () => {
    document.body.innerHTML = `
      <div class="message-select-wrapper-answer-current">
        <div class="qk-markdown">参考了6篇结果</div>
      </div>
    `;
    const answer = document.querySelector<HTMLElement>(
      "[class*='message-select-wrapper-answer']",
    )!;

    expect(createWebsiteAdapter("qianwen").extractText(answer)).toBe("");

    document.querySelector(".qk-markdown")!.textContent = "检索到 66 篇资料";
    expect(createWebsiteAdapter("qianwen").extractText(answer)).toBe("");
  });

  it("lets hunyuan infer an icon-only submit button next to the composer", () => {
    document.body.innerHTML = `
      <main>
        <section class="chat-input-shell">
          <div class="ql-editor" contenteditable="true" role="textbox">prompt</div>
          <button aria-label="工具" type="button">tool</button>
          <button aria-label="模型选择" type="button">model</button>
          <button id="send" type="button"><span aria-hidden="true">></span></button>
        </section>
      </main>
    `;

    const composer = document.querySelector(".ql-editor") as HTMLElement;
    const rects = new Map<HTMLElement, DOMRect>([
      [composer, makeRect(0, 0, 260, 48)],
      [document.querySelector("[aria-label='工具']") as HTMLElement, makeRect(270, 8, 40, 32)],
      [document.querySelector("[aria-label='模型选择']") as HTMLElement, makeRect(316, 8, 40, 32)],
      [document.getElementById("send") as HTMLElement, makeRect(362, 4, 40, 40)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? makeRect(0, 0, 100, 24);
    });

    const adapter = createWebsiteAdapter("hunyuan");
    expect(adapter.findSubmit(composer)?.id).toBe("send");
  });

  it("lets hunyuan fall back to a page-level icon-only submit button when the composer shell only exposes tools", () => {
    document.body.innerHTML = `
      <main>
        <section class="chat-input-shell">
          <div class="ql-editor" contenteditable="true" role="textbox">prompt</div>
          <button aria-label="宸ュ叿" type="button">tool</button>
        </section>
        <footer class="agent-dialogue-footer">
          <button id="hunyuan-send" class="agent-dialogue__send t-button" type="button">
            <span aria-hidden="true">></span>
          </button>
        </footer>
      </main>
    `;

    const composer = document.querySelector(".ql-editor") as HTMLElement;
    const rects = new Map<HTMLElement, DOMRect>([
      [composer, makeRect(0, 0, 260, 48)],
      [document.querySelector("[aria-label='宸ュ叿']") as HTMLElement, makeRect(270, 8, 40, 32)],
      [document.getElementById("hunyuan-send") as HTMLElement, makeRect(362, 4, 40, 40)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? makeRect(0, 0, 100, 24);
    });

    const adapter = createWebsiteAdapter("hunyuan");
    expect(adapter.findSubmit(composer)?.id).toBe("hunyuan-send");
  });

  it("lets kimi infer an icon-only submit button next to the composer", () => {
    document.body.innerHTML = `
      <main>
        <section class="chat-input-shell">
          <div class="chat-input-editor" contenteditable="true" role="textbox">prompt</div>
          <button class="toolkit-trigger-btn" type="button">tools</button>
          <button class="current-model" type="button">K2.6</button>
          <button id="kimi-send" type="button"><span aria-hidden="true">></span></button>
        </section>
      </main>
    `;

    const composer = document.querySelector(".chat-input-editor") as HTMLElement;
    const rects = new Map<HTMLElement, DOMRect>([
      [composer, makeRect(0, 0, 260, 48)],
      [document.querySelector(".toolkit-trigger-btn") as HTMLElement, makeRect(270, 8, 40, 32)],
      [document.querySelector(".current-model") as HTMLElement, makeRect(316, 8, 60, 32)],
      [document.getElementById("kimi-send") as HTMLElement, makeRect(382, 4, 40, 40)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? makeRect(0, 0, 100, 24);
    });

    const adapter = createWebsiteAdapter("kimi");
    expect(adapter.findSubmit(composer)?.id).toBe("kimi-send");
  });

  it("lets doubao infer an icon-only submit button next to the composer", () => {
    document.body.innerHTML = `
      <main>
        <section class="chat-input-shell">
          <button id="doubao-more" type="button">更多</button>
          <button id="doubao-send" type="button"><span aria-hidden="true">></span></button>
          <textarea class="semi-input-textarea semi-input-textarea-autosize"></textarea>
          <button id="doubao-auto" type="button">自动播报</button>
        </section>
      </main>
    `;

    const composer = document.querySelector("textarea") as HTMLElement;
    const rects = new Map<HTMLElement, DOMRect>([
      [document.getElementById("doubao-more") as HTMLElement, makeRect(0, 8, 56, 32)],
      [document.getElementById("doubao-send") as HTMLElement, makeRect(66, 4, 40, 40)],
      [composer, makeRect(112, 0, 260, 48)],
      [document.getElementById("doubao-auto") as HTMLElement, makeRect(382, 8, 80, 32)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rects.get(this) ?? makeRect(0, 0, 100, 24);
    });

    const adapter = createWebsiteAdapter("doubao");
    expect(adapter.findSubmit(composer)?.id).toBe("doubao-send");
  });

  it("lets provider adapters override streaming indicator detection", () => {
    document.body.innerHTML = `
      <main>
        <div id="doubao"><span class="typing-cursor"></span></div>
        <div id="qianwen"><span class="answer-loading"></span></div>
        <div id="hunyuan"><span class="agent-message__loading"></span></div>
      </main>
    `;

    expect(createWebsiteAdapter("doubao").hasStreamingIndicator(
      document.getElementById("doubao") as HTMLElement,
    )).toBe(true);
    expect(createWebsiteAdapter("qianwen").hasStreamingIndicator(
      document.getElementById("qianwen") as HTMLElement,
    )).toBe(true);
    expect(createWebsiteAdapter("hunyuan").hasStreamingIndicator(
      document.getElementById("hunyuan") as HTMLElement,
    )).toBe(true);
  });

  it("uses conservative long-generation timing for Qianwen", () => {
    const adapter = createWebsiteAdapter("qianwen");
    expect(adapter.getFirstTokenTimeoutMs()).toBe(300_000);
    expect(adapter.getCompletionStableThresholdMs()).toBe(10_000);
  });

  it("exposes auth interruption and recoverable blocker detection on adapters", () => {
    history.replaceState({}, "", "/auth/login");
    document.body.innerHTML = `
      <main>
        <button type="button">Continue with Google</button>
        <div role="alert" class="provider-error-modal">Verification required. Try again.</div>
      </main>
    `;

    const chatgpt = createWebsiteAdapter("chatgpt");
    expect(chatgpt.detectAuthInterruption()).toBe("Login or provider verification is required before sending.");
    expect(chatgpt.findRecoverableBlocker()).toBe("Verification required. Try again.");
  });

  it("detects Claude logout and login gates through the adapter boundary", () => {
    history.replaceState({}, "", "/logout");
    document.body.innerHTML = `
      <main>
        <button type="button">Continue with Google</button>
      </main>
    `;

    const claude = createWebsiteAdapter("claude");
    expect(claude.detectAuthInterruption()).toBe("Login or provider verification is required before sending.");
  });

  it("detects user turns with a submitted snippet through the adapter boundary", () => {
    document.body.innerHTML = `
      <main>
        <form>
          <textarea id="prompt-textarea"></textarea>
        </form>
        <div data-message-author-role="user">accepted user prompt</div>
      </main>
    `;

    const adapter = createWebsiteAdapter("chatgpt");
    const composer = document.getElementById("prompt-textarea") as HTMLTextAreaElement;

    expect(adapter.hasUserTurnWithSnippet("accepted user prompt", composer)).toBe(true);
    expect(adapter.hasUserTurnWithSnippet("missing snippet", composer)).toBe(false);
  });

  it("adds chinese auth and blocker detection overrides for doubao", () => {
    document.body.innerHTML = `
      <main>
        <div>请先登录后继续使用</div>
        <div role="dialog" class="verify-modal">验证频繁，请稍后重试</div>
        <div class="justify-end" data-message-id="u1">豆包已接收的问题</div>
        <textarea id="prompt"></textarea>
      </main>
    `;
    const adapter = createWebsiteAdapter("doubao");
    const composer = document.getElementById("prompt") as HTMLTextAreaElement;

    expect(adapter.detectAuthInterruption()).toContain("interrupted");
    expect(adapter.findRecoverableBlocker()).toBe("验证频繁，请稍后重试");
    expect(adapter.hasUserTurnWithSnippet("豆包已接收的问题", composer)).toBe(true);
  });

  it("adds chinese auth and blocker detection overrides for qianwen", () => {
    document.body.innerHTML = `
      <main>
        <div>请登录阿里云账号继续使用</div>
        <div role="alert" class="limit-error">触发安全验证，请重试</div>
        <div class="chat-question-item">千问已接收的问题</div>
        <textarea id="prompt"></textarea>
      </main>
    `;
    const adapter = createWebsiteAdapter("qianwen");
    const composer = document.getElementById("prompt") as HTMLTextAreaElement;

    expect(adapter.detectAuthInterruption()).toContain("interrupted");
    expect(adapter.findRecoverableBlocker()).toBe("触发安全验证，请重试");
    expect(adapter.hasUserTurnWithSnippet("千问已接收的问题", composer)).toBe(true);
  });

  it("detects current Chinese provider error cards for Qianwen and DeepSeek", () => {
    document.body.innerHTML = `
      <main>
        <div role="alert" class="toast-error">服务器繁忙，请稍后重试</div>
      </main>
    `;
    expect(createWebsiteAdapter("qianwen").findRecoverableBlocker()).toBe(
      "服务器繁忙，请稍后重试",
    );
    expect(createWebsiteAdapter("deepseek").findRecoverableBlocker()).toBe(
      "服务器繁忙，请稍后重试",
    );
  });

  it("detects Kimi login-gated composers before submit is attempted", () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-input-editor" contenteditable="true" role="textbox"></div>
        <button class="kimi-button info phone-login-action" type="button">Send verification code</button>
        <button class="next-sidebar-history-list__login" type="button">Login</button>
      </main>
    `;

    const adapter = createWebsiteAdapter("kimi");
    expect(adapter.findSubmit(document.querySelector(".chat-input-editor") as HTMLElement)).toBeNull();
    expect(adapter.detectAuthInterruption()).toBe("Login or provider verification is required before sending.");
  });

  it("does not infer Kimi login state from long conversation text", () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-content-item chat-content-item-assistant">
          Audit phone verification methods and login failure mitigations.
        </div>
        <textarea placeholder="Ask Kimi"></textarea>
      </main>
    `;
    const adapter = createWebsiteAdapter("kimi");

    expect(adapter.findComposer()).not.toBeNull();
    expect(adapter.detectAuthInterruption()).toBeUndefined();
  });

  it("adds chinese auth and blocker detection overrides for hunyuan", () => {
    document.body.innerHTML = `
      <main>
        <div>请先使用QQ登录</div>
        <div role="dialog" class="login-error">安全验证失败，请稍后重试</div>
        <div class="self-message">元宝已接收的问题</div>
        <textarea id="prompt"></textarea>
      </main>
    `;
    const adapter = createWebsiteAdapter("hunyuan");
    const composer = document.getElementById("prompt") as HTMLTextAreaElement;

    expect(adapter.detectAuthInterruption()).toContain("interrupted");
    expect(adapter.findRecoverableBlocker()).toBe("安全验证失败，请稍后重试");
    expect(adapter.hasUserTurnWithSnippet("元宝已接收的问题", composer)).toBe(true);
  });
});

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({}),
  } as DOMRect;
}
