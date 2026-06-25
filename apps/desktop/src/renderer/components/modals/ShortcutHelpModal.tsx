import { X } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../../stores/settings-store";

const LABELS: Record<keyof typeof DEFAULT_SHORTCUTS, string> = {
  focusSearch: "聚焦搜索",
  newConversation: "新建会话",
  toggleSidebar: "切换侧栏",
  toggleProvider: "切换 Provider 网站",
  toggleTheme: "切换主题",
  copyLastResponse: "复制最后回复",
  previousConversation: "上一个会话",
  nextConversation: "下一个会话",
  showShortcutHelp: "快捷键帮助",
};

export function ShortcutHelpModal() {
  const open = useAppStore((state) => state.shortcutHelpOpen);
  const setOpen = useAppStore((state) => state.setShortcutHelpOpen);
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[#06080dbd] p-8 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section className="w-full max-w-lg rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-tertiary)] p-6 shadow-2xl">
        <header className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">快捷键</h2>
          <button
            className="rounded-lg p-2 hover:bg-[var(--color-bg-hover)]"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="space-y-1">
          {(
            Object.entries({ ...DEFAULT_SHORTCUTS, ...shortcuts }) as [
              keyof typeof DEFAULT_SHORTCUTS,
              string,
            ][]
          ).map(([action, binding]) => (
            <div
              key={action}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--color-bg-hover)]"
            >
              <span className="text-sm">{LABELS[action]}</span>
              <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-2 py-1 font-mono text-xs">
                {binding}
              </kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
