import { create } from "zustand";
import type { ProviderId } from "@aihub/core";
import type { AppSettingsPayload } from "@aihub/core";

const STORAGE_KEY = "aihub-settings";

export type ThemeMode = "dark" | "light" | "system";

export interface ShortcutBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
}

export type ShortcutAction =
  | "focusSearch"
  | "newConversation"
  | "toggleSidebar"
  | "toggleProvider"
  | "toggleTheme"
  | "copyLastResponse"
  | "previousConversation"
  | "nextConversation"
  | "showShortcutHelp";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  focusSearch: "Ctrl+K",
  newConversation: "Ctrl+N",
  toggleSidebar: "Ctrl+\\",
  toggleProvider: "Ctrl+Shift+M",
  toggleTheme: "Ctrl+Shift+T",
  copyLastResponse: "Ctrl+Shift+C",
  previousConversation: "Ctrl+[",
  nextConversation: "Ctrl+]",
  showShortcutHelp: "Ctrl+/",
};

export interface SettingsState {
  theme: ThemeMode;
  defaultProvider: ProviderId | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  providerDrawerWidth: number;
  hasCompletedOnboarding: boolean;
  shortcuts: Record<ShortcutAction, string>;

  setTheme: (theme: ThemeMode) => void;
  setDefaultProvider: (provider: ProviderId | null) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setProviderDrawerWidth: (width: number) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setShortcut: (action: ShortcutAction, binding: string) => void;
  initializeFromMain: () => Promise<void>;
  applyImportedSettings: (settings: AppSettingsPayload) => void;
  reset: () => void;
}

function loadSettings(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveSettings(state: Partial<SettingsState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

const defaults = {
  theme: "system" as ThemeMode,
  defaultProvider: null as ProviderId | null,
  sidebarWidth: 270,
  sidebarCollapsed: false,
  providerDrawerWidth: 520,
  hasCompletedOnboarding: false,
  shortcuts: DEFAULT_SHORTCUTS,
};

const persisted = loadSettings();

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaults,
  ...persisted,

  setTheme: (theme: ThemeMode) => {
    set({ theme });
    saveSettings({ ...loadSettings(), theme });
    applyTheme(theme);
  },

  setDefaultProvider: (provider: ProviderId | null) => {
    set({ defaultProvider: provider });
    saveSettings({ ...loadSettings(), defaultProvider: provider });
  },

  setSidebarWidth: (width: number) => {
    set({ sidebarWidth: width });
    saveSettings({ ...loadSettings(), sidebarWidth: width });
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed });
    saveSettings({ ...loadSettings(), sidebarCollapsed: collapsed });
  },

  setProviderDrawerWidth: (width) => {
    set({ providerDrawerWidth: width });
    saveSettings({ ...loadSettings(), providerDrawerWidth: width });
  },

  setHasCompletedOnboarding: (completed: boolean) => {
    set({ hasCompletedOnboarding: completed });
    saveSettings({ ...loadSettings(), hasCompletedOnboarding: completed });
  },

  setShortcut: (action, binding) => {
    const shortcuts = {
      ...useSettingsStore.getState().shortcuts,
      [action]: binding,
    };
    set({ shortcuts });
    saveSettings({ ...loadSettings(), shortcuts });
  },

  initializeFromMain: async () => {
    try {
      const remote = await window.aihub.getSettings();
      if (Object.keys(remote).length) {
        const next = {
          ...useSettingsStore.getState(),
          ...remote,
          shortcuts: {
            ...DEFAULT_SHORTCUTS,
            ...useSettingsStore.getState().shortcuts,
            ...remote.shortcuts,
          },
        };
        set(next);
        saveSettings(remote);
        applyTheme(next.theme);
      } else {
        await window.aihub.setSettings(settingsPayload(
          useSettingsStore.getState(),
        ));
      }
    } catch {
      return;
    }
  },

  applyImportedSettings: (settings) => {
    const next = {
      ...useSettingsStore.getState(),
      ...settings,
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        ...useSettingsStore.getState().shortcuts,
        ...settings.shortcuts,
      },
    };
    set(next);
    saveSettings(settings);
    applyTheme(next.theme);
  },

  reset: () => {
    set(defaults);
    saveSettings(defaults);
  },
}));

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    root.dataset.theme = prefersDark ? "dark" : "light";
  } else {
    root.dataset.theme = theme;
  }
}

// Initialize theme on load
const initialTheme =
  (loadSettings() as { theme?: ThemeMode })?.theme ?? "system";
applyTheme(initialTheme);

useSettingsStore.subscribe((state) => {
  const payload = settingsPayload(state);
  saveSettings(payload);
  void window.aihub.setSettings(payload).catch(() => undefined);
});

function settingsPayload(state: SettingsState): AppSettingsPayload {
  return {
    theme: state.theme,
    defaultProvider: state.defaultProvider,
    sidebarWidth: state.sidebarWidth,
    sidebarCollapsed: state.sidebarCollapsed,
    providerDrawerWidth: state.providerDrawerWidth,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
    shortcuts: state.shortcuts,
  };
}
