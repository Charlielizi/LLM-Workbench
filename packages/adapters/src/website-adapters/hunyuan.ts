import {
  DefaultWebsiteAdapter,
  documentOrder,
  type NetworkMonitorConfig,
} from "./base";

export class HunyuanWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("hunyuan");
  }

  findSubmit(composer?: HTMLElement | null): HTMLElement | null {
    const direct = super.findSubmit(composer);
    if (direct || !composer) return direct;

    const composerRect = composer.getBoundingClientRect();
    const container = composer.parentElement?.closest(
      "form,section,footer,main,[class*='editor'],[class*='input'],[class*='composer'],[class*='footer'],[class*='bottom'],[class*='chat']",
    ) ?? composer.parentElement;

    const rankScope = (scope: ParentNode): HTMLElement | null => {
      const candidates = Array.from(
        scope.querySelectorAll<HTMLElement>("button,[role='button']"),
      ).filter((element) => this.isVisibleCandidate(element));
      if (candidates.length === 0) return null;

      const ranked = candidates
        .map((element) => ({
          element,
          score: this.submitCandidateScore(element, composerRect),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);

      return ranked[0]?.element ?? null;
    };

    return rankScope(container ?? document.body) ?? rankScope(document.body);
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["chat", "agent"],
      silenceThresholdMs: 3_000,
    };
  }

  resolveContentRoot(element: HTMLElement): HTMLElement {
    return element.querySelector<HTMLElement>(".hyc-common-markdown,.markdown-body,[class*='agent-message']") ?? element;
  }

  protected turnSelectors(): readonly string[] {
    return [".agent-chat__list__item", "[data-role]"];
  }

  protected userMessageSelectors(): readonly string[] {
    return [".agent-chat__list__item--human", "[data-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return [".agent-chat__list__item--ai", "[data-role='assistant']"];
  }

  isSubmitPending(submit?: HTMLElement | null): boolean {
    return super.isSubmitPending(submit) ||
      Boolean(submit?.matches("[class*='sending'],[class*='button-loading'],[data-status='loading']"));
  }

  hasStreamingIndicator(root: HTMLElement | null): boolean {
    return super.hasStreamingIndicator(root) ||
      Boolean(
        root?.querySelector(
          "[class*='agent-message__loading']," +
            "[class*='text-typing']," +
            "[class*='is-streaming']," +
            "[data-status='generating']",
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
    if (/登录|验证码|QQ登录|微信登录|安全验证|手机号/i.test(bodyText)) {
      return "Login or provider verification interrupted message submission.";
    }
    return super.detectAuthInterruption();
  }

  findRecoverableBlocker(): string | undefined {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[role='alert'],[role='dialog'],[class*='modal'],[class*='toast'],[class*='verify'],[class*='error'],[class*='login']",
      ),
    );
    const blocker = candidates.find((candidate) =>
      /验证|安全|频繁|限制|错误|失败|重试/i.test(candidate.innerText || candidate.textContent || ""),
    ) ?? candidates.find((candidate) =>
      /登录/i.test(candidate.innerText || candidate.textContent || ""),
    );
    if (blocker) {
      return (blocker.innerText || blocker.textContent || "").trim() ||
        super.findRecoverableBlocker();
    }
    return super.findRecoverableBlocker();
  }

  hasUserTurnWithSnippet(snippet: string, composer: HTMLElement): boolean {
    if (!snippet) return false;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-message-author-role='user'],[data-role='user'],[class*='user-message'],[class*='self-message'],[class*='question-message']",
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
        if (element.matches("[class*='agent-message']")) return 30;
        if (element.matches("[class*='markdown-body']")) return 20;
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
    const normalized = label.toLowerCase();

    if (
      /工具|模型|深度思考|联?网搜索|写作|编程|解题|历史|新建|分享|更多|上传/i.test(label)
    ) {
      return -500;
    }

    let score = 0;
    if (element.matches("[type='submit']")) score += 300;
    if (element.matches("[data-testid*='send'],[class*='send'],[class*='submit']")) {
      score += 260;
    }
    if (/发送|send|submit/i.test(label)) score += 240;
    if (!label) score += 100;
    if (rect.left >= composerRect.right - 24) score += 140;
    if (Math.abs(rect.top - composerRect.top) <= 80) score += 80;
    if (Math.abs(rect.bottom - composerRect.bottom) <= 80) score += 80;
    if (rect.left >= composerRect.left) score += 40;
    if (normalized === "") score += 20;
    score -= Math.abs(rect.left - composerRect.right);
    score -= Math.abs(rect.top - composerRect.top) / 2;
    return score;
  }
}
