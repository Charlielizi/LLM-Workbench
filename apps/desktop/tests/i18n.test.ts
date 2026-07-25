import { afterEach, describe, expect, it, vi } from "vitest";
import { translate, type TranslationKey } from "../src/renderer/i18n";
import { resolveLocale } from "../src/renderer/stores/settings-store";

describe("renderer translations", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("translates every typed key in both supported locales", () => {
    const representativeKeys: TranslationKey[] = [
      "nav.settings",
      "chat.send",
      "settings.providers",
      "conversation.deleteDescription",
      "message.status.signInRequired",
      "welcome.headline",
    ];

    for (const key of representativeKeys) {
      expect(translate("zh-CN", key)).not.toBe(translate("en-US", key));
      expect(translate("zh-CN", key)).not.toContain(`{${key}}`);
    }
  });

  it("interpolates parameters", () => {
    expect(
      translate("zh-CN", "conversation.deleteManyTitle", { count: 3 }),
    ).toContain("3");
    expect(
      translate("en-US", "conversation.deleteManyTitle", { count: 3 }),
    ).toContain("3");
  });

  it("uses Chinese only for a Chinese system locale", () => {
    vi.stubGlobal("navigator", { language: "zh-CN" });
    expect(resolveLocale("system")).toBe("zh-CN");
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(resolveLocale("system")).toBe("en-US");
  });
});
