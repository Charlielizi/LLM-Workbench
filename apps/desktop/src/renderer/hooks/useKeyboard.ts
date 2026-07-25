import { useEffect } from "react";
import type { ShortcutAction } from "../stores/settings-store";
import { useAppStore } from "../stores/app-store";
import {
  DEFAULT_SHORTCUTS,
  useSettingsStore,
} from "../stores/settings-store";
import { useToastStore } from "../stores/toast-store";
import { messageText } from "../utils/message-text";
import { shortcutFromKeyboardEvent } from "../utils/shortcuts";
import { useDialogStore } from "../stores/dialog-store";
import { translate } from "../i18n";

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-shortcut-recorder]")
      ) {
        return;
      }
      const app = useAppStore.getState();
      const modalOpen =
        useDialogStore.getState().modalCount > 0 ||
        Boolean(useDialogStore.getState().request) ||
        Boolean(useDialogStore.getState().inputRequest) ||
        Boolean(app.transfer) ||
        app.shortcutHelpOpen ||
        app.systemPromptModalOpen ||
        app.comparisonSetupOpen;
      if (modalOpen) {
        if (event.key === "Escape") {
          app.setTransfer(undefined);
          app.setShortcutHelpOpen(false);
          app.setSystemPromptModalOpen(false);
          app.setComparisonSetupOpen(false);
        }
        return;
      }
      const binding = shortcutFromKeyboardEvent(event);
      if (!binding) return;
      const settings = useSettingsStore.getState();
      const shortcuts = { ...DEFAULT_SHORTCUTS, ...settings.shortcuts };
      const action = (
        Object.entries(shortcuts) as [ShortcutAction, string][]
      ).find(([, value]) => value === binding)?.[0];

      if (!action) return;
      event.preventDefault();

      if (action === "focusSearch") {
        document.querySelector<HTMLInputElement>("#conversation-search")?.focus();
      } else if (action === "newConversation") {
        void app.createConversation(settings.defaultProvider ?? "chatgpt");
      } else if (action === "toggleSidebar") {
        settings.setSidebarCollapsed(!settings.sidebarCollapsed);
      } else if (action === "toggleProvider") {
        const conversation =
          app.snapshot.conversations.find(
            (item) => item.id === app.selectedConversationId,
          ) ?? app.snapshot.conversations[0];
        if (conversation) {
          const provider = app.snapshot.providers.find(
            (item) => item.id === conversation.provider,
          );
          void window.aihub.setProviderWebsiteVisible(
            conversation.provider,
            !provider?.websiteVisible,
          );
        }
      } else if (action === "toggleTheme") {
        settings.setTheme(
          document.documentElement.dataset.theme === "dark" ? "light" : "dark",
        );
      } else if (action === "copyLastResponse") {
        const conversation = app.snapshot.conversations.find(
          (item) => item.id === app.selectedConversationId,
        );
        const response = conversation?.messages
          .filter((message) => message.role === "assistant")
          .at(-1);
        if (response) {
          void navigator.clipboard.writeText(messageText(response));
          useToastStore
            .getState()
            .addToast(
              translate(settings.locale, "toast.lastResponseCopied"),
              "success",
            );
        }
      } else if (
        action === "previousConversation" ||
        action === "nextConversation"
      ) {
        const conversations = app.snapshot.conversations;
        const index = conversations.findIndex(
          (item) => item.id === app.selectedConversationId,
        );
        const offset = action === "previousConversation" ? -1 : 1;
        const target = conversations[index + offset];
        if (target) app.selectConversation(target.id);
      } else if (action === "showShortcutHelp") {
        app.setShortcutHelpOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
