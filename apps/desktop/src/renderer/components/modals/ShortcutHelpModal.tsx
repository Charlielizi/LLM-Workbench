import { useI18n, type TranslationKey } from "../../i18n";
import { useAppStore } from "../../stores/app-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../../stores/settings-store";
import { displayShortcut } from "../../utils/shortcuts";
import { Dialog } from "../shared/Dialog";

const LABELS: Record<keyof typeof DEFAULT_SHORTCUTS, TranslationKey> = {
  focusSearch: "shortcuts.focusSearch",
  newConversation: "shortcuts.newConversation",
  toggleSidebar: "shortcuts.toggleSidebar",
  toggleProvider: "shortcuts.toggleProvider",
  toggleTheme: "shortcuts.toggleTheme",
  copyLastResponse: "shortcuts.copyLastResponse",
  previousConversation: "shortcuts.previousConversation",
  nextConversation: "shortcuts.nextConversation",
  showShortcutHelp: "shortcuts.showShortcutHelp",
};

export function ShortcutHelpModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.shortcutHelpOpen);
  const setOpen = useAppStore((state) => state.setShortcutHelpOpen);
  const shortcuts = useSettingsStore((state) => state.shortcuts);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={t("shortcuts.title")}
      widthClass="w-[min(520px,calc(100vw-48px))]"
    >
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
            <span className="text-sm">{t(LABELS[action])}</span>
            <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-2 py-1 font-mono text-xs">
              {displayShortcut(binding)}
            </kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
