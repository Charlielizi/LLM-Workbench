import { DefaultWebsiteAdapter, type NetworkMonitorConfig } from "./base";

const claudeAuthPathPattern = /^\/(logout|login|signup|welcome|auth)(\/|$)/i;
const claudeLoginGatePattern =
  /log in|sign up|continue with google|continue with email|verify|verification|security check/i;

export class ClaudeWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("claude");
  }

  override detectAuthInterruption(): string | undefined {
    if (claudeAuthPathPattern.test(location.pathname)) {
      return "Login or provider verification is required before sending.";
    }
    const bodyText = (document.body.innerText ?? document.body.textContent ?? "").toLowerCase();
    if (!this.findComposer() && claudeLoginGatePattern.test(bodyText)) {
      return "Login or provider verification is required before sending.";
    }
    return super.detectAuthInterruption();
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["completion", "chat_conversations"],
      silenceThresholdMs: 3_000,
    };
  }

  protected turnSelectors(): readonly string[] {
    return ["[data-testid*='message']", "[data-is-streaming]"];
  }

  protected userMessageSelectors(): readonly string[] {
    return ["[data-testid*='user']", "[data-role='user']", ".font-user-message"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return ["[data-testid*='assistant']", "[data-role='assistant']", ".font-claude-response"];
  }
}
