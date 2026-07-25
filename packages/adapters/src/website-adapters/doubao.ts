import {
  DefaultWebsiteAdapter,
  documentOrder,
  type NetworkMonitorConfig,
} from "./base";

export class DoubaoWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("doubao");
  }

  findSubmit(composer?: HTMLElement | null): HTMLElement | null {
    const direct = super.findSubmit(composer);
    if (direct || !composer) return direct;

    const composerRect = composer.getBoundingClientRect();
    const container = composer.parentElement?.closest(
      "form,section,footer,main,[class*='editor'],[class*='input'],[class*='composer'],[class*='footer'],[class*='bottom'],[class*='chat']",
    ) ?? composer.parentElement;
    let candidates = Array.from(
      (container ?? document.body).querySelectorAll<HTMLElement>("button,[role='button']"),
    ).filter((element) => this.isVisibleCandidate(element));
    if (candidates.length === 0) {
      candidates = Array.from(
        document.body.querySelectorAll<HTMLElement>("button,[role='button']"),
      ).filter((element) => this.isVisibleCandidate(element));
    }

    if (candidates.length === 0) return null;

    const ranked = candidates
      .map((element) => ({
        element,
        score: this.submitCandidateScore(element, composerRect),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);

    return ranked[0]?.element ?? null;
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["samantha", "conversation", "chat"],
      silenceThresholdMs: 3_000,
    };
  }

  getCleanModeCss(): string {
    return [
      "#flow_chat_sidebar, nav, aside { display: none !important; }",
      "[class*='recommend'], [class*='activity'], [class*='banner'], [class*='sidebar'] { display: none !important; }",
    ].join("\n");
  }

  resolveContentRoot(element: HTMLElement): HTMLElement {
    return element.querySelector<HTMLElement>(
      ".flow-markdown-body,.md-box-root,[data-container-type='block-v2'],[data-target-id='message-box-target-id']",
    ) ?? element;
  }

  getConversationListScrollContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>("#flow_chat_sidebar [class*='scroll'],#flow_chat_sidebar");
  }

  getConversationMessageScrollContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[class*='v_list_scroller'],main [class*='scroll']");
  }

  protected turnSelectors(): readonly string[] {
    return ["[data-target-id='message-box-target-id']"];
  }

  protected userMessageSelectors(): readonly string[] {
    return ["[data-message-id].justify-end", "[data-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return [
      "[data-role='assistant']",
      "[data-message-role='assistant']",
      "[data-message-id].assistant-message",
      "[data-message-id].bot-message",
      "[data-container-type='block-v2']",
      ".flow-markdown-body",
      ".md-box-root",
    ];
  }

  protected assistantCandidates(): HTMLElement[] {
    const candidates = super.assistantCandidates();
    const evidence = "[data-role='assistant'],[data-message-role='assistant'],[data-message-id].assistant-message,[data-message-id].bot-message,[data-container-type='block-v2'],.flow-markdown-body,.md-box-root";
    return candidates.filter((element) =>
      !element.matches("[data-message-id]") ||
      element.matches(evidence) ||
      Boolean(element.querySelector(evidence)),
    );
  }

  isSubmitPending(submit?: HTMLElement | null): boolean {
    return super.isSubmitPending(submit) ||
      Boolean(submit?.matches("[class*='sending'],[class*='submit-loading'],[data-status='sending']"));
  }

  hasStreamingIndicator(root: HTMLElement | null): boolean {
    return super.hasStreamingIndicator(root) ||
      Boolean(
        root?.querySelector(
          "[class*='typing-cursor']," +
            "[class*='streaming']," +
            "[class*='generating']," +
            "[data-status='generating']",
        ),
      );
  }

  isGenerating(): boolean {
    const thinking = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-plugin-identifier*='receive-message-box:thinking']," +
          "[class*='loading-container']",
      ),
    ).some((element) => this.isVisibleCandidate(element));
    return super.isGenerating() || thinking;
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
    if (/登录|登陆|手机号|验证码|人机验证|继续使用/i.test(bodyText)) {
      return "Login or provider verification interrupted message submission.";
    }
    return super.detectAuthInterruption();
  }

  findRecoverableBlocker(): string | undefined {
    const blocker = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[role='alert'],[role='dialog'],[class*='modal'],[class*='toast'],[class*='verify'],[class*='captcha'],[class*='error']",
      ),
    ).find((candidate) => /验证|验证码|频繁|限制|错误|失败|重试/i.test(candidate.innerText || candidate.textContent || ""));
    if (blocker) {
      return (blocker.innerText || blocker.textContent || "").trim() || super.findRecoverableBlocker();
    }
    return super.findRecoverableBlocker();
  }

  hasUserTurnWithSnippet(snippet: string, composer: HTMLElement): boolean {
    if (!snippet) return false;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-message-author-role='user'],[data-role='user'],.justify-end,[class*='user-message'],[data-message-id].justify-end",
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
        if (element.matches("[data-message-id]:not(.justify-end)")) return 40;
        if (element.matches("[data-target-id='message-box-target-id']")) return 35;
        if (element.matches("[data-container-type='block-v2']")) return 30;
        if (element.matches(".flow-markdown-body,.md-box-root")) return 20;
        return 0;
      };
      const order = documentOrder(left, right);
      const scoreDelta = score(left) - score(right);
      return scoreDelta === 0 ? order : scoreDelta;
    });
  }

  private isVisibleCandidate(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") === 0
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  private submitCandidateScore(
    element: HTMLElement,
    composerRect: DOMRect | { top: number; right: number; bottom: number; left: number },
  ): number {
    if (
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true"
    ) {
      return -1_000;
    }

    const rect = element.getBoundingClientRect();
    const label = (
      element.getAttribute("aria-label") ??
      element.getAttribute("title") ??
      element.innerText ??
      element.textContent ??
      ""
    ).replace(/\s+/g, " ").trim();

    if (
      element.matches("[class*='tool'],[class*='model'],[class*='upload'],[class*='history'],[class*='speech']") ||
      /鏇村|宸ュ叿|妯″瀷|涓婁紶|鍘嗗彶|鎾姤|璇煶|鏂囦欢|鑷姩|agent/i.test(label)
    ) {
      return -500;
    }

    const horizontalGap = Math.min(
      Math.abs(rect.left - composerRect.right),
      Math.abs(rect.right - composerRect.left),
    );
    const topGap = Math.abs(rect.top - composerRect.top);
    const bottomGap = Math.abs(rect.bottom - composerRect.bottom);

    let score = 0;
    if (element.matches("[type='submit']")) score += 300;
    if (element.matches("[data-testid*='send'],[class*='send'],[class*='submit']")) {
      score += 260;
    }
    if (/鍙戦€亅send|submit/i.test(label)) score += 240;
    if (!label) score += 140;
    if (horizontalGap <= 32) score += 180;
    else if (horizontalGap <= 96) score += 120;
    else if (horizontalGap <= 180) score += 60;
    if (topGap <= 80) score += 70;
    if (bottomGap <= 80) score += 90;
    if (rect.bottom >= composerRect.top - 12 && rect.top <= composerRect.bottom + 12) {
      score += 40;
    }
    score -= horizontalGap;
    score -= topGap / 2;
    return score;
  }
}
