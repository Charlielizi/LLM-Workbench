import { DefaultWebsiteAdapter, type NetworkMonitorConfig } from "./base";

const chatGptAuthPathPattern = /^\/auth(\/|$)/i;
const chatGptLoginGatePattern =
  /continue with google|continue with apple|continue with phone|log in|sign up|verification|captcha/i;

export class ChatGptWebsiteAdapter extends DefaultWebsiteAdapter {
  constructor() {
    super("chatgpt");
  }

  override detectAuthInterruption(): string | undefined {
    if (chatGptAuthPathPattern.test(location.pathname)) {
      return "Login or provider verification is required before sending.";
    }
    const bodyText = (document.body.innerText ?? document.body.textContent ?? "").toLowerCase();
    if (!this.findComposer() && chatGptLoginGatePattern.test(bodyText)) {
      return "Login or provider verification is required before sending.";
    }
    return super.detectAuthInterruption();
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig {
    return {
      urlPatterns: ["backend-api", "conversation"],
      urlPathEndsWith: ["conversation"],
      silenceThresholdMs: 3_000,
    };
  }

  protected turnSelectors(): readonly string[] {
    return ["[data-testid^='conversation-turn']"];
  }

  protected userMessageSelectors(): readonly string[] {
    return ["[data-message-author-role='user']"];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return ["[data-message-author-role='assistant']"];
  }
}
