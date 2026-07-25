import { DefaultWebsiteAdapter, type NetworkMonitorConfig } from "./base";

export class DeepSeekWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("deepseek");
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["completion", "chat_session"],
      silenceThresholdMs: 3_000,
    };
  }

  getConversationMessageScrollContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".ds-virtual-list-items,[class*='virtual-list']");
  }

  protected turnSelectors(): readonly string[] {
    return [".ds-message"];
  }

  protected userMessageSelectors(): readonly string[] {
    return [".ds-message.ds-message--user", "[data-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return [
      ".ds-message--assistant .ds-markdown",
      ".ds-message:not(.ds-message--user) .ds-markdown",
      ".ds-markdown",
      "[data-role='assistant']",
    ];
  }

  findRecoverableBlocker(): string | undefined {
    const inherited = super.findRecoverableBlocker();
    if (inherited) return inherited;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[role='alert'],[role='dialog'],[class*='toast'],[class*='error'],[class*='failed'],[class*='limit']",
      ),
    );
    const blocker = candidates.find((candidate) => {
      const style = window.getComputedStyle(candidate);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const text = (candidate.innerText || candidate.textContent || "").trim();
      return /服务器繁忙|系统繁忙|请求失败|生成失败|网络错误|网络异常|请重试|稍后重试|达到上限|请求频繁|余额不足|暂时无法/i.test(text);
    });
    return blocker
      ? (blocker.innerText || blocker.textContent || "").trim()
      : undefined;
  }
}
