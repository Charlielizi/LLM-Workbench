// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  normalizeShortcutBinding,
  findShortcutConflict,
  shortcutFromKeyboardEvent,
  validateShortcut,
} from "../src/renderer/utils/shortcuts";
import {
  DEFAULT_SHORTCUTS,
  normalizeShortcutRecord,
} from "../src/renderer/stores/settings-store";

describe("shortcut normalization", () => {
  it("normalizes legacy command aliases and modifier order", () => {
    expect(normalizeShortcutBinding("shift+cmd+p")).toBe("Ctrl+Shift+P");
    expect(normalizeShortcutBinding("Control+Alt+ArrowUp")).toBe(
      "Ctrl+Alt+ArrowUp",
    );
  });

  it("captures Meta as the canonical main modifier", () => {
    expect(
      shortcutFromKeyboardEvent({
        key: "k",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe("Ctrl+K");
  });

  it("rejects unmodified characters, Escape, and system-reserved bindings", () => {
    expect(validateShortcut("K").error).toBe("modifier-required");
    expect(validateShortcut("Escape").error).toBe("invalid");
    expect(validateShortcut("Alt+F4").error).toBe("reserved");
    expect(validateShortcut("Ctrl+Alt+Delete").error).toBe("reserved");
    expect(validateShortcut("Ctrl+Shift+Escape").error).toBe("reserved");
    expect(normalizeShortcutBinding("Ctrl+Control")).toBeUndefined();
  });

  it("detects conflicts with another action", () => {
    expect(
      findShortcutConflict(
        {
          newConversation: "Ctrl+N",
          focusSearch: "Ctrl+K",
        },
        "newConversation",
        "Ctrl+K",
      ),
    ).toBe("focusSearch");
  });

  it("repairs invalid and conflicting legacy bindings to defaults", () => {
    const repaired = normalizeShortcutRecord({
      focusSearch: "not-a-shortcut",
      newConversation: "Ctrl+K",
      toggleSidebar: "Ctrl+K",
    });

    expect(repaired.repaired).toBe(true);
    expect(repaired.shortcuts.focusSearch).toBe(DEFAULT_SHORTCUTS.focusSearch);
    expect(repaired.shortcuts.newConversation).toBe(
      DEFAULT_SHORTCUTS.newConversation,
    );
    expect(repaired.shortcuts.toggleSidebar).toBe(
      DEFAULT_SHORTCUTS.toggleSidebar,
    );
    expect(
      new Set(Object.values(repaired.shortcuts).filter(Boolean)).size,
    ).toBe(Object.values(repaired.shortcuts).filter(Boolean).length);
  });
});
