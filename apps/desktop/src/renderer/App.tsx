import { useEffect, useRef } from "react";
import { AppShell } from "./components/layout/AppShell";
import { Sidebar } from "./components/layout/Sidebar";
import { MenuBar, TopBar } from "./components/layout/TopBar";
import { ChatView } from "./components/chat/ChatView";
import { TransferModal } from "./components/modals/TransferModal";
import { ToastViewport } from "./components/shared/Toast";
import { ShortcutHelpModal } from "./components/modals/ShortcutHelpModal";
import { SystemPromptModal } from "./components/modals/SystemPromptModal";
import { ComparisonSetupModal } from "./components/modals/ComparisonSetupModal";
import { ComparisonView } from "./components/comparison/ComparisonView";
import { SettingsView } from "./components/settings/SettingsView";
import { ConfirmDialogHost } from "./components/shared/ConfirmDialogHost";
import { InputDialogHost } from "./components/shared/InputDialogHost";
import { useKeyboard } from "./hooks/useKeyboard";
import { useAppStore } from "./stores/app-store";
import { applyTheme, useSettingsStore } from "./stores/settings-store";
import { useToastStore } from "./stores/toast-store";
import { useI18n } from "./i18n";

export function App() {
  useKeyboard();
  const { t } = useI18n();
  const addToast = useToastStore((state) => state.addToast);
  const syncError = useSettingsStore((state) => state.syncError);
  const repairedShortcuts = useSettingsStore(
    (state) => state.repairedShortcuts,
  );
  const acknowledgeShortcutRepair = useSettingsStore(
    (state) => state.acknowledgeShortcutRepair,
  );
  const lastSyncError = useRef<string | undefined>(undefined);
  const initialize = useAppStore((state) => state.initialize);
  const dispose = useAppStore((state) => state.dispose);
  const theme = useSettingsStore((state) => state.theme);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useSettingsStore(
    (state) => state.sidebarCollapsed,
  );
  const providerDrawerWidth = useSettingsStore(
    (state) => state.providerDrawerWidth,
  );
  const initializeSettings = useSettingsStore(
    (state) => state.initializeFromMain,
  );
  const providerDrawerOpen = useAppStore((state) =>
    state.snapshot.providers.some((provider) => provider.websiteVisible),
  );
  const activeComparisonId = useAppStore(
    (state) => state.activeComparisonId,
  );
  const workspaceView = useAppStore((state) => state.workspaceView);

  useEffect(() => {
    void initialize();
    return dispose;
  }, [dispose, initialize]);

  useEffect(() => {
    void initializeSettings();
  }, [initializeSettings]);

  useEffect(() => {
    if (!syncError) {
      lastSyncError.current = undefined;
      return;
    }
    if (lastSyncError.current === syncError) return;
    lastSyncError.current = syncError;
    addToast(t("settings.saveFailed", { error: syncError }), "error", 7000);
  }, [addToast, syncError, t]);

  useEffect(() => {
    if (!repairedShortcuts) return;
    addToast(t("settings.shortcutRepaired"), "warning", 7000);
    acknowledgeShortcutRepair();
  }, [
    acknowledgeShortcutRepair,
    addToast,
    repairedShortcuts,
    t,
  ]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => applyTheme("system");
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, [theme]);

  useEffect(() => {
    if (providerDrawerOpen) {
      void window.aihub.setProviderLayout(providerDrawerWidth);
    }
  }, [providerDrawerOpen, providerDrawerWidth]);

  return (
    <AppShell
      sidebarWidth={sidebarCollapsed ? 72 : sidebarWidth}
      providerDrawerOpen={workspaceView !== "settings" && providerDrawerOpen}
      menubar={<MenuBar />}
      topbar={<TopBar />}
      sidebar={<Sidebar />}
      workspace={
        workspaceView === "settings" ? (
          <SettingsView />
        ) : workspaceView === "comparison" && activeComparisonId ? (
          <ComparisonView />
        ) : (
          <ChatView />
        )
      }
      modals={
        <>
          <TransferModal />
          <ShortcutHelpModal />
          <SystemPromptModal />
          <ComparisonSetupModal />
          <ConfirmDialogHost />
          <InputDialogHost />
        </>
      }
      toasts={<ToastViewport />}
    />
  );
}
