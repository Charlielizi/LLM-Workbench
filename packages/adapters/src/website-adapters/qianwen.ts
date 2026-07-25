import {
  DefaultWebsiteAdapter,
  documentOrder,
  type NetworkMonitorConfig,
} from "./base";

export class QianwenWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("qianwen");
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["conversation", "chat"],
      silenceThresholdMs: 3_000,
    };
  }

  getFirstTokenTimeoutMs(): number {
    return 300_000;
  }

  getCompletionStableThresholdMs(): number {
    return 10_000;
  }

  getCleanModeCss(): string {
    return [
      "nav, aside, header { display: none !important; }",
      "[class*='chat-recommend'], [class*='suggest'], [class*='banner'] { display: none !important; }",
    ].join("\n");
  }

  resolveContentRoot(element: HTMLElement): HTMLElement {
    return element.querySelector<HTMLElement>(
      "div.qk-markdown,div[class*='message-select-wrapper-answer'],div[data-chat-answers-wrap],div.answer-common-card",
    ) ?? element;
  }

  extractText(element: HTMLElement): string {
    const text = super.extractText(element);
    if (
      /^(?:\u53c2\u8003\u4e86\s*\d+\s*\u7bc7|\u68c0\u7d22\u5230\s*\d+\s*\u7bc7)/.test(
        text.trim(),
      )
    ) {
      return "";
    }
    return text;
  }

  getConversationMessageScrollContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      ".message-list-scroll-container,#message-list-scroller,[class*='message-list'][class*='scroll']",
    );
  }

  protected turnSelectors(): readonly string[] {
    return [".chat-round[data-chat]", "[data-chat-list-key]"];
  }

  protected userMessageSelectors(): readonly string[] {
    return [".message-card-wrap.question", ".question-text-card", "[data-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return [
      "div[class*='message-select-wrapper-answer']",
      "div[class*='chat-answers-card-wrap']",
      "div[data-chat-answers-wrap]",
      "div.answer-common-card",
      "div.qk-markdown",
    ];
  }

  isSubmitPending(submit?: HTMLElement | null): boolean {
    return super.isSubmitPending(submit) ||
      Boolean(submit?.matches("[class*='send-loading'],[class*='btn-loading'],[data-state='submitting']"));
  }

  hasStreamingIndicator(root: HTMLElement | null): boolean {
    return super.hasStreamingIndicator(root) ||
      Boolean(
        root?.querySelector(
          "[class*='answer-loading']," +
            "[class*='typing-cursor']," +
            "[class*='is-streaming']," +
            "[data-status='streaming']",
        ),
      );
  }

  detectAuthInterruption(): string | undefined {
    const inherited = super.detectAuthInterruption();
    if (inherited) return inherited;
    if (this.findRecoverableBlocker()) {
      return "Login or provider verification interrupted message submission.";
    }
    const composer = this.findComposer();
    const submit = this.findSubmit(composer);
    if (composer && (submit || this.definition.submitWithEnter)) return undefined;
    const bodyText = document.body.innerText || document.body.textContent || "";
    if (/登录|手机号|验证码|安全验证|继续使用|阿里云|淘宝/i.test(bodyText)) {
      return "Login or provider verification interrupted message submission.";
    }
    return super.detectAuthInterruption();
  }

  findRecoverableBlocker(): string | undefined {
    const blocker = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[role='alert'],[role='dialog'],[class*='modal'],[class*='toast'],[class*='verify'],[class*='error'],[class*='limit']",
      ),
    ).find((candidate) =>
      /验证|安全|频繁|限制|错误|失败|重试|服务器繁忙|系统繁忙|网络异常|达到上限/i.test(
        candidate.innerText || candidate.textContent || "",
      )
    );
    if (blocker) {
      return (blocker.innerText || blocker.textContent || "").trim() || super.findRecoverableBlocker();
    }
    return super.findRecoverableBlocker();
  }

  hasUserTurnWithSnippet(snippet: string, composer: HTMLElement): boolean {
    if (!snippet) return false;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-message-author-role='user'],[data-role='user'],[class*='user-message'],[class*='question-item'],[class*='chat-question']",
      ),
    );
    return candidates.some((candidate) => {
      if (candidate === composer || candidate.contains(composer)) return false;
      return (candidate.innerText || candidate.textContent || "").includes(snippet);
    }) || super.hasUserTurnWithSnippet(snippet, composer);
  }

  protected sortAssistantCandidates(candidates: HTMLElement[]): HTMLElement[] {
    return [...candidates].sort((left, right) => {
      const score = (element: HTMLElement) => {
        if (element.matches("div[class*='message-select-wrapper-answer']")) return 50;
        if (element.matches("div[class*='chat-answers-card-wrap']")) return 45;
        if (element.matches("div[data-chat-answers-wrap]")) return 40;
        if (element.matches("div.answer-common-card")) return 35;
        if (element.matches("div.qk-markdown")) return 20;
        return 0;
      };
      const order = documentOrder(left, right);
      const scoreDelta = score(left) - score(right);
      return scoreDelta === 0 ? order : scoreDelta;
    });
  }
}
