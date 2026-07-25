import type { ProviderId } from "@aihub/core";
import { providerDefinitions } from "./definitions";
import {
  ChatGptWebsiteAdapter,
  ClaudeWebsiteAdapter,
  DeepSeekWebsiteAdapter,
  DoubaoWebsiteAdapter,
  HunyuanWebsiteAdapter,
  KimiWebsiteAdapter,
  QianwenWebsiteAdapter,
} from "./website-adapters/providers";
import type { WebsiteAdapter } from "./website-adapters/base";

export * from "./website-adapters/base";

export function createWebsiteAdapter(provider: ProviderId): WebsiteAdapter {
  switch (provider) {
    case "chatgpt":
      return new ChatGptWebsiteAdapter();
    case "claude":
      return new ClaudeWebsiteAdapter();
    case "doubao":
      return new DoubaoWebsiteAdapter();
    case "kimi":
      return new KimiWebsiteAdapter();
    case "deepseek":
      return new DeepSeekWebsiteAdapter();
    case "hunyuan":
      return new HunyuanWebsiteAdapter();
    case "qianwen":
      return new QianwenWebsiteAdapter();
  }
}

export const websiteAdapterIds: ProviderId[] = Object.keys(providerDefinitions) as ProviderId[];
