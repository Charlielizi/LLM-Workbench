// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProviderId } from "@aihub/core";
import { createWebsiteAdapter } from "@aihub/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
}

function appendAssistant(provider: ProviderId, text: string): void {
  const main = document.querySelector("main") ?? document.body;
  const htmlByProvider: Record<ProviderId, string> = {
    chatgpt: `<div data-message-author-role="assistant" data-message-id="new-chatgpt">${text}</div>`,
    claude: `<div data-testid="assistant-message" data-turn-id="new-claude">${text}</div>`,
    doubao: `<div data-message-id="new-doubao" data-role="assistant">${text}</div>`,
    kimi: `<div data-role="assistant" data-turn-id="new-kimi">${text}</div>`,
    deepseek: `<div data-role="assistant" data-turn-id="new-deepseek">${text}</div>`,
    hunyuan: `<div class="agent-message" data-turn-id="new-hunyuan">${text}</div>`,
    qianwen: `<div class="message-select-wrapper-answer-new">${text}</div>`,
  };
  main.insertAdjacentHTML("beforeend", htmlByProvider[provider]);
}

describe("website adapter provider fixtures", () => {
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

  it.each([
    ["chatgpt", "chatgpt-conversation.html"],
    ["claude", "claude-conversation.html"],
    ["doubao", "doubao-assistant.html"],
    ["kimi", "kimi-conversation.html"],
    ["deepseek", "deepseek-conversation.html"],
    ["hunyuan", "hunyuan-assistant.html"],
    ["qianwen", "qianwen-assistant.html"],
  ] as const)("binds the next assistant turn for %s", (provider, fixtureName) => {
    document.body.innerHTML = fixture(fixtureName);
    const adapter = createWebsiteAdapter(provider);
    const anchor = adapter.captureAnchor();

    appendAssistant(provider, `new ${provider} answer`);

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(binding?.fallbackUsed).toBe(false);
    expect(binding?.element.textContent).toContain(`new ${provider} answer`);
  });

  it("relocates an anchor through a virtual-list rerender and ignores hidden stale turns", () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" data-turn-id="old-2">
          virtualized anchor answer
        </div>
      </main>
    `;
    const adapter = createWebsiteAdapter("chatgpt");
    const anchor = adapter.captureAnchor();

    document.body.innerHTML = fixture("virtual-list-rerender.html");

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(binding?.element.textContent).toContain("virtualized new answer");
  });

  it("extracts stable role-aware snapshots without nested assistant duplicates", async () => {
    document.body.innerHTML = `
      <main>
        <div data-target-id="message-box-target-id">
          <div data-message-id="user-1" class="justify-end">question</div>
        </div>
        <div data-target-id="message-box-target-id">
          <div data-message-id="assistant-1" data-role="assistant">
            <div class="flow-markdown-body"><p>answer</p><button>Copy</button></div>
          </div>
        </div>
      </main>`;
    const adapter = createWebsiteAdapter("doubao");
    const snapshot = await adapter.extractConversationSnapshot();

    expect(snapshot.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(snapshot.messages.map((message) => message.key)).toEqual([
      "user:user-1",
      "assistant:assistant-1",
    ]);
    expect(snapshot.messages[1]?.content[0]).toMatchObject({ type: "text", text: "answer" });
  });

  it.each([
    [
      "chatgpt",
      "/c/history-current",
      "/c/history-older",
      `<div data-message-author-role="user" data-message-id="user-chatgpt">fixture question</div>
       <div data-message-author-role="assistant" data-message-id="assistant-chatgpt">fixture answer</div>`,
    ],
    [
      "claude",
      "/chat/history-current",
      "/chat/history-older",
      `<div data-testid="user-message" data-turn-id="user-claude">fixture question</div>
       <div data-testid="assistant-message" data-turn-id="assistant-claude">fixture answer</div>`,
    ],
    [
      "doubao",
      "/chat/history_current",
      "/chat/history_older",
      `<div data-role="user" data-message-id="user-doubao">fixture question</div>
       <div data-role="assistant" data-message-id="assistant-doubao">fixture answer</div>`,
    ],
    [
      "kimi",
      "/chat/history_current",
      "/chat/history_older",
      `<div class="chat-content-item chat-content-item-user" data-turn-id="user-kimi">fixture question</div>
       <div class="chat-content-item chat-content-item-assistant" data-turn-id="assistant-kimi">fixture answer</div>`,
    ],
    [
      "deepseek",
      "/a/chat/s/history-current",
      "/a/chat/s/history-older",
      `<div data-role="user" data-turn-id="user-deepseek">fixture question</div>
       <div data-role="assistant" data-turn-id="assistant-deepseek">fixture answer</div>`,
    ],
    [
      "hunyuan",
      "/chat/history_current",
      "/chat/history_older",
      `<div data-role="user" data-turn-id="user-hunyuan">fixture question</div>
       <div data-role="assistant" data-turn-id="assistant-hunyuan">fixture answer</div>`,
    ],
    [
      "qianwen",
      "/chat/history_current",
      "/chat/history_older",
      `<div class="chat-round" data-chat="fixture">
         <div class="message-card-wrap question" data-message-id="user-qianwen">fixture question</div>
         <div class="message-select-wrapper-answer-current" data-turn-id="assistant-qianwen">
           <div class="chat-answers-card-wrap">
             <div class="answer-common-card">
               <div class="qk-markdown">fixture answer</div>
             </div>
           </div>
         </div>
       </div>`,
    ],
  ] as const)(
    "extracts website history list and current conversation snapshot for %s",
    async (provider, currentPath, olderPath, messagesHtml) => {
      history.replaceState({}, "", currentPath);
      document.title = `${provider} fixture history`;
      document.body.innerHTML = `
        <nav>
          <a href="${currentPath}" title="Current fixture" aria-current="page">Current fixture</a>
          <a href="${olderPath}" title="Older fixture">Older fixture</a>
        </nav>
        <main>
          ${messagesHtml}
        </main>`;
      const adapter = createWebsiteAdapter(provider);

      const conversations = adapter.listVisibleConversations();
      expect(conversations).toHaveLength(2);
      expect(conversations[0]).toMatchObject({
        title: "Current fixture",
        isActive: true,
      });
      expect(conversations[1]).toMatchObject({
        title: "Older fixture",
        isActive: false,
      });

      const snapshot = await adapter.extractConversationSnapshot({
        maxRounds: 1,
        maxMessages: 10,
      });
      expect(snapshot).toMatchObject({
        title: `${provider} fixture history`,
        partial: false,
        limitReached: false,
      });
      expect(snapshot.url).toContain(currentPath);
      expect(snapshot.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(snapshot.messages.map((message) => message.key)).toEqual([
        `user:user-${provider}`,
        `assistant:assistant-${provider}`,
      ]);
      expect(snapshot.messages.map((message) => message.order)).toEqual([0, 1]);

      const limited = await adapter.extractConversationSnapshot({
        maxRounds: 1,
        maxMessages: 1,
      });
      expect(limited).toMatchObject({
        partial: true,
        limitReached: true,
      });
    },
  );

  it("recognizes the current DeepSeek primary send control", () => {
    document.body.innerHTML = `
      <main>
        <textarea placeholder="Message DeepSeek">test</textarea>
        <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle"></div>
      </main>`;
    const adapter = createWebsiteAdapter("deepseek");

    expect(adapter.findSubmit(adapter.findComposer())).toMatchObject({
      className: expect.stringContaining("ds-button--primary"),
    });
  });

  it("recognizes the current Yuanbao anchor send control", () => {
    document.body.innerHTML = `
      <main>
        <div class="ql-editor" contenteditable="true" role="textbox">test</div>
        <a id="yuanbao-send-btn" class="style__send-btn___current"><span class="icon-send"></span></a>
      </main>`;
    const adapter = createWebsiteAdapter("hunyuan");

    expect(adapter.findSubmit(adapter.findComposer())?.id).toBe("yuanbao-send-btn");
  });

  it("binds Kimi's complete assistant turn instead of an inner fragment", () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-content-item chat-content-item-user">question</div>
      </main>`;
    const adapter = createWebsiteAdapter("kimi");
    const anchor = adapter.captureAnchor();
    document.querySelector("main")?.insertAdjacentHTML("beforeend", `
      <div class="chat-content-item chat-content-item-assistant">
        <span class="segment-content">AI</span><span>HUB_KIMI_TOKEN</span>
      </div>`);

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(adapter.extractText(binding!.element)).toContain("AIHUB_KIMI_TOKEN");
    expect(binding?.element.classList).toContain("chat-content-item-assistant");
  });

  it("binds Qianwen's current nested answer hierarchy", () => {
    document.body.innerHTML = `
      <main>
        <div class="chat-round" data-chat="old">
          <div class="message-card-wrap question">old question</div>
          <div class="message-select-wrapper-answer-old">
            <div class="chat-answers-card-wrap">
              <div class="answer-common-card">
                <div class="qk-markdown">old answer</div>
              </div>
            </div>
          </div>
        </div>
      </main>`;
    const adapter = createWebsiteAdapter("qianwen");
    const anchor = adapter.captureAnchor();
    document.querySelector("main")?.insertAdjacentHTML("beforeend", `
      <div class="chat-round last-message-item" data-chat="new">
        <div class="message-card-wrap question">new question</div>
        <div class="message-select-wrapper-answer-current">
          <div class="chat-answers-card-wrap">
            <div class="answer-common-card">
              <div id="qk-markdown-react" class="qk-markdown qk-markdown-complete">AIHUB_QIANWEN_TOKEN</div>
            </div>
          </div>
        </div>
      </div>`);

    const binding = adapter.findAssistantAfterAnchor(anchor);
    expect(adapter.extractText(binding!.element)).toContain("AIHUB_QIANWEN_TOKEN");
  });

  it.each([
    ["chatgpt", "chatgpt-conversation.html"],
    ["claude", "claude-conversation.html"],
    ["doubao", "doubao-assistant.html"],
    ["kimi", "kimi-conversation.html"],
    ["deepseek", "deepseek-conversation.html"],
    ["hunyuan", "hunyuan-assistant.html"],
    ["qianwen", "qianwen-assistant.html"],
  ] as const)("keeps core controls queryable after clean mode css is injected for %s", (provider, fixtureName) => {
    document.body.innerHTML = fixture(fixtureName);
    const adapter = createWebsiteAdapter(provider);
    const style = document.createElement("style");
    style.textContent = adapter.getCleanModeCss();
    document.head.appendChild(style);

    expect(adapter.findComposer()).not.toBeNull();
    expect(adapter.findSubmit(adapter.findComposer())).not.toBeNull();
    expect(adapter.fallbackAssistant()).not.toBeNull();
  });

  it.each([
    ["doubao", "doubao-auth-blocked.html", "豆包已接收的问题", "验证频繁，请稍后重试"],
    ["qianwen", "qianwen-auth-blocked.html", "千问已接收的问题", "触发安全验证，请重试"],
    ["hunyuan", "hunyuan-auth-blocked.html", "元宝已接收的问题", "安全验证失败，请稍后重试"],
  ] as const)(
    "detects auth interruption, blocker and user turn on %s auth fixture",
    (provider, fixtureName, userSnippet, blockerText) => {
      document.body.innerHTML = fixture(fixtureName);
      const adapter = createWebsiteAdapter(provider);
      const composer = adapter.findComposer();

      expect(composer).not.toBeNull();
      expect(adapter.detectAuthInterruption()).toContain("interrupted");
      expect(adapter.findRecoverableBlocker()).toBe(blockerText);
      expect(adapter.hasUserTurnWithSnippet(userSnippet, composer!)).toBe(true);
    },
  );
});
