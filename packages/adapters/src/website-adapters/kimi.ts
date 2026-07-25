import { DefaultWebsiteAdapter, type NetworkMonitorConfig } from "./base";

const kimiLoginGatePattern = /login|sign in|verification|verify|phone|\u767B\u5F55|\u9A8C\u8BC1|\u624B\u673A/i;

export class KimiWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("kimi");
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
      urlPatterns: ["completion", "chat"],
      silenceThresholdMs: 3_000,
    };
  }

  getCompletionStableThresholdMs(): number {
    return 10_000;
  }

  protected turnSelectors(): readonly string[] {
    return [".chat-content-item", ".segment"];
  }

  protected userMessageSelectors(): readonly string[] {
    return [".chat-content-item-user", ".segment.segment-user", "[data-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return [".chat-content-item-assistant", ".segment.segment-assistant", "[data-role='assistant']"];
  }

  detectAuthInterruption(): string | undefined {
    const composer = this.findComposer();
    const submit = this.findSubmit(composer);
    const authInputs = Array.from(
      document.querySelectorAll<HTMLElement>(
        "input[type='tel'],input[placeholder*='验证码'],input[placeholder*='手机号']",
      ),
    ).find((element) => this.isVisibleCandidate(element));
    if (authInputs) {
      return "Login or provider verification is blocking the composer.";
    }

    const loginButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button,[role='button'],a[href]",
      ),
    ).filter((element) => this.isVisibleCandidate(element));
    const hasVisibleLoginGate = loginButtons.some((element) => {
      if (element.matches("[class*='phone-login-action'],[class*='history-list__login'],[class*='login']")) {
        return true;
      }
      const label = (
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        element.innerText ??
        element.textContent ??
        ""
      ).replace(/\s+/g, " ").trim().toLowerCase();
      return kimiLoginGatePattern.test(label);
    });

    if (hasVisibleLoginGate && composer && !submit) {
      return "Login or provider verification is required before sending.";
    }

    return super.detectAuthInterruption();
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
      element.matches("[class*='phone-login-action'],[class*='history-list__login'],[class*='login']") ||
      kimiLoginGatePattern.test(label)
    ) {
      return -500;
    }

    if (
      element.matches(".toolkit-trigger-btn,.current-model,[class*='model'],[class*='toolkit']") ||
      /模型|agent|附件|上传|工具|ppt|研究|网页|文档|表格|代码|搜索|历史|新建|更多/i.test(label)
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
    score -= Math.abs(rect.left - composerRect.right);
    score -= Math.abs(rect.top - composerRect.top) / 2;
    return score;
  }
}
