import { useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { ChatView } from "./components/chat/ChatView";
import { TransferModal } from "./components/modals/TransferModal";
import { ToastViewport } from "./components/shared/Toast";
import { ShortcutHelpModal } from "./components/modals/ShortcutHelpModal";
import { SystemPromptModal } from "./components/modals/SystemPromptModal";
import { ComparisonSetupModal } from "./components/modals/ComparisonSetupModal";
import { ComparisonView } from "./components/comparison/ComparisonView";
import { SettingsModal } from "./components/modals/SettingsModal";
import { useKeyboard } from "./hooks/useKeyboard";
import { useAppStore } from "./stores/app-store";
import { applyTheme, useSettingsStore } from "./stores/settings-store";

export function App() {
  useKeyboard();
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

  useEffect(() => {
    void initialize();
    return dispose;
  }, [dispose, initialize]);

  useEffect(() => {
    void initializeSettings();
  }, [initializeSettings]);

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
      providerDrawerOpen={providerDrawerOpen}
      topbar={<TopBar />}
      sidebar={<Sidebar />}
      workspace={activeComparisonId ? <ComparisonView /> : <ChatView />}
      modals={
        <>
          <TransferModal />
          <ShortcutHelpModal />
          <SystemPromptModal />
          <ComparisonSetupModal />
          <SettingsModal />
        </>
      }
      toasts={<ToastViewport />}
    />
  );
}
