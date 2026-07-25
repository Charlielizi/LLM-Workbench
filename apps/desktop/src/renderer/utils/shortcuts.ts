const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"] as const;
const RESERVED_SHORTCUTS = new Set([
  "Alt+F4",
  "Alt+Tab",
  "Alt+Escape",
  "Ctrl+Escape",
  "Ctrl+Alt+Delete",
  "Ctrl+Shift+Escape",
]);

const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  spacebar: "Space",
  esc: "Escape",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

export function shortcutFromKeyboardEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string | undefined {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return undefined;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(normalizeKey(event.key));
  return validateShortcut(parts.join("+")).binding;
}

export function normalizeShortcutBinding(binding: string): string | undefined {
  const parts = binding
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const key = normalizeKey(parts.at(-1) ?? "");
  const modifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const normalized = part.toLowerCase();
    if (["ctrl", "control", "cmd", "command", "meta"].includes(normalized)) {
      modifiers.add("Ctrl");
    } else if (normalized === "alt" || normalized === "option") {
      modifiers.add("Alt");
    } else if (normalized === "shift") {
      modifiers.add("Shift");
    } else {
      return undefined;
    }
  }
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return validateShortcut([...ordered, key].join("+")).binding;
}

export function validateShortcut(binding: string): {
  binding?: string;
  error?: "invalid" | "modifier-required" | "reserved";
} {
  const parts = binding.split("+").filter(Boolean);
  const key = parts.at(-1) ?? "";
  const canonical = parts.join("+");
  if (RESERVED_SHORTCUTS.has(canonical)) return { error: "reserved" };
  if (
    !key ||
    key === "Escape" ||
    ["Control", "Ctrl", "Meta", "Alt", "Shift"].includes(key)
  ) {
    return { error: "invalid" };
  }
  const hasModifier = parts.length > 1;
  const isFunctionKey = /^F(?:[1-9]|1[0-2])$/.test(key);
  if (!hasModifier && !isFunctionKey) return { error: "modifier-required" };
  return { binding: canonical };
}

export function displayShortcut(binding: string): string {
  if (navigator.platform.toLowerCase().includes("mac")) {
    return binding
      .replace("Ctrl+", "⌘")
      .replace("Alt+", "⌥")
      .replace("Shift+", "⇧");
  }
  return binding;
}

export function findShortcutConflict<TAction extends string>(
  shortcuts: Record<TAction, string>,
  action: NoInfer<TAction>,
  binding: string,
): TAction | undefined {
  return (Object.keys(shortcuts) as TAction[]).find(
    (candidate) =>
      candidate !== action && shortcuts[candidate] === binding,
  );
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}
