import { create } from "zustand";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettingsPayload,
  type CloseBehavior,
  type ContrastMode,
  type ContentWidth,
  type InterfaceDensity,
  type LocaleMode,
  type MotionPreference,
  type NotificationPreferences,
  type NormalizedAppSettings,
  type ProviderApiConfig,
  type ProviderBackendMode,
  type ProviderId,
  type UiScale,
  type UpdatePolicy,
} from "@aihub/core";
import { normalizeProviderDrawerWidth } from "../utils/layout";
import { normalizeShortcutBinding } from "../utils/shortcuts";

const BOOTSTRAP_KEY = "aihub-bootstrap";

export type ThemeMode = "dark" | "light" | "system";

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

interface SettingsState extends NormalizedAppSettings {
  hydrated: boolean;
  syncError?: string;
  repairedShortcuts: boolean;
  acknowledgeShortcutRepair: () => void;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
  setDefaultProvider: (provider: ProviderId | null) => void;
  setProviderEnabled: (provider: ProviderId, enabled: boolean) => void;
  moveProvider: (provider: ProviderId, direction: -1 | 1) => void;
  reorderProvider: (provider: ProviderId, target: ProviderId) => void;
  setProviderBackend: (
    provider: ProviderId,
    backend: ProviderBackendMode,
  ) => void;
  setProviderApiConfig: (
    provider: ProviderId,
    config: ProviderApiConfig,
  ) => void;
  setAutoSyncWebHistory: (enabled: boolean) => void;
  setUiScale: (scale: UiScale) => void;
  setDensity: (density: InterfaceDensity) => void;
  setContentWidth: (width: ContentWidth) => void;
  setCodeWrap: (enabled: boolean) => void;
  setMotion: (motion: MotionPreference) => void;
  setContrastMode: (mode: ContrastMode) => void;
  setAutomaticBackup: (enabled: boolean) => void;
  setBackupRetentionDays: (days: 7 | 30 | 90 | 365) => void;
  setTrashRetentionDays: (days: 0 | 7 | 30 | 90) => void;
  setTrayEnabled: (enabled: boolean) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setLaunchAtLogin: (enabled: boolean) => void;
  setNotificationPreference: (
    key: keyof NotificationPreferences,
    enabled: boolean,
  ) => void;
  setUpdatePolicy: (policy: UpdatePolicy) => void;
  resetAppearance: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setProviderDrawerWidth: (width: number) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setShortcut: (action: ShortcutAction, binding: string) => void;
  clearShortcut: (action: ShortcutAction) => void;
  resetShortcut: (action: ShortcutAction) => void;
  resetShortcuts: () => void;
  initializeFromMain: () => Promise<void>;
  applyImportedSettings: (settings: AppSettingsPayload) => void;
  reset: () => void;
}

const bootstrap = loadBootstrap();
const initialSettings = withRendererDefaults(
  normalizeAppSettings({
    ...DEFAULT_APP_SETTINGS,
    theme: bootstrap.theme ?? DEFAULT_APP_SETTINGS.theme,
    locale: bootstrap.locale ?? DEFAULT_APP_SETTINGS.locale,
  }),
);

let persistenceRevision = 0;
let persistenceQueue = Promise.resolve();

export const useSettingsStore = create<SettingsState>((set, get) => {
  const commit = (patch: AppSettingsPayload): void => {
    const previous = settingsPayload(get());
    const normalized = withRendererDefaults(
      normalizeAppSettings(patch, previous),
    );
    set({ ...normalized, syncError: undefined });
    applyAppearance(normalized);
    saveBootstrap(normalized);
    if (!get().hydrated) return;
    const revision = ++persistenceRevision;
    persistenceQueue = persistenceQueue.then(async () => {
      try {
        await window.aihub.setSettings(normalized);
      } catch (cause) {
        if (revision !== persistenceRevision) return;
        let restored = withRendererDefaults(normalizeAppSettings(previous));
        try {
          const authoritative = await window.aihub.getSettings();
          const normalizedShortcuts = normalizeShortcutRecord(
            authoritative.shortcuts,
          ).shortcuts;
          restored = withRendererDefaults(
            normalizeAppSettings({
              ...authoritative,
              shortcuts: normalizedShortcuts,
            }),
          );
        } catch {
          // The previous renderer state is the safest available fallback.
        }
        set({
          ...restored,
          syncError: cause instanceof Error ? cause.message : String(cause),
        });
        applyAppearance(restored);
        saveBootstrap(restored);
      }
    });
  };

  return {
    ...initialSettings,
    hydrated: false,
    repairedShortcuts: false,
    acknowledgeShortcutRepair: () => set({ repairedShortcuts: false }),
    setTheme: (theme) => commit({ theme }),
    setLocale: (locale) => commit({ locale }),
    setDefaultProvider: (defaultProvider) => commit({ defaultProvider }),
    setProviderEnabled: (provider, enabled) => {
      const current = get().enabledProviders;
      if (!enabled && current.length === 1 && current[0] === provider) return;
      commit({
        enabledProviders: enabled
          ? [...current, provider]
          : current.filter((entry) => entry !== provider),
      });
    },
    moveProvider: (provider, direction) => {
      const providerOrder = [...get().providerOrder];
      const index = providerOrder.indexOf(provider);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= providerOrder.length) return;
      [providerOrder[index], providerOrder[target]] = [
        providerOrder[target]!,
        providerOrder[index]!,
      ];
      commit({ providerOrder });
    },
    reorderProvider: (provider, target) => {
      if (provider === target) return;
      const providerOrder = get().providerOrder.filter(
        (entry) => entry !== provider,
      );
      const targetIndex = providerOrder.indexOf(target);
      providerOrder.splice(targetIndex < 0 ? providerOrder.length : targetIndex, 0, provider);
      commit({ providerOrder });
    },
    setProviderBackend: (provider, backend) =>
      commit({
        providerBackends: { ...get().providerBackends, [provider]: backend },
      }),
    setProviderApiConfig: (provider, config) =>
      commit({
        providerApiConfigs: {
          ...get().providerApiConfigs,
          [provider]: config,
        },
      }),
    setAutoSyncWebHistory: (autoSyncWebHistory) =>
      commit({ autoSyncWebHistory }),
    setUiScale: (uiScale) => commit({ uiScale }),
    setDensity: (density) => commit({ density }),
    setContentWidth: (contentWidth) => commit({ contentWidth }),
    setCodeWrap: (codeWrap) => commit({ codeWrap }),
    setMotion: (motion) => commit({ motion }),
    setContrastMode: (contrastMode) => commit({ contrastMode }),
    setAutomaticBackup: (automaticBackup) => commit({ automaticBackup }),
    setBackupRetentionDays: (backupRetentionDays) =>
      commit({ backupRetentionDays }),
    setTrashRetentionDays: (trashRetentionDays) =>
      commit({ trashRetentionDays }),
    setTrayEnabled: (trayEnabled) =>
      commit({
        trayEnabled,
        ...(trayEnabled ? {} : { closeBehavior: "exit" }),
      }),
    setCloseBehavior: (closeBehavior) => commit({ closeBehavior }),
    setLaunchAtLogin: (launchAtLogin) => commit({ launchAtLogin }),
    setNotificationPreference: (key, enabled) =>
      commit({
        notificationPreferences: {
          ...get().notificationPreferences,
          [key]: enabled,
        },
      }),
    setUpdatePolicy: (updatePolicy) => commit({ updatePolicy }),
    resetAppearance: () =>
      commit({
        theme: DEFAULT_APP_SETTINGS.theme,
        uiScale: DEFAULT_APP_SETTINGS.uiScale,
        density: DEFAULT_APP_SETTINGS.density,
        contentWidth: DEFAULT_APP_SETTINGS.contentWidth,
        codeWrap: DEFAULT_APP_SETTINGS.codeWrap,
        motion: DEFAULT_APP_SETTINGS.motion,
        contrastMode: DEFAULT_APP_SETTINGS.contrastMode,
      }),
    setSidebarWidth: (sidebarWidth) => commit({ sidebarWidth }),
    setSidebarCollapsed: (sidebarCollapsed) => commit({ sidebarCollapsed }),
    setProviderDrawerWidth: (width) =>
      commit({ providerDrawerWidth: normalizeProviderDrawerWidth(width) }),
    setHasCompletedOnboarding: (hasCompletedOnboarding) =>
      commit({ hasCompletedOnboarding }),
    setShortcut: (action, binding) => {
      const normalized = normalizeShortcutBinding(binding);
      if (!normalized) return;
      commit({ shortcuts: { ...get().shortcuts, [action]: normalized } });
    },
    clearShortcut: (action) =>
      commit({ shortcuts: { ...get().shortcuts, [action]: "" } }),
    resetShortcut: (action) =>
      commit({
        shortcuts: {
          ...get().shortcuts,
          [action]: DEFAULT_SHORTCUTS[action],
        },
      }),
    resetShortcuts: () => commit({ shortcuts: DEFAULT_SHORTCUTS }),
    initializeFromMain: async () => {
      try {
        const remote = await window.aihub.getSettings();
        const { shortcuts, repaired } = normalizeShortcutRecord(
          remote.shortcuts,
        );
        const normalized = withRendererDefaults(
          normalizeAppSettings({
            ...remote,
            providerDrawerWidth: normalizeProviderDrawerWidth(
              remote.providerDrawerWidth ??
                DEFAULT_APP_SETTINGS.providerDrawerWidth,
            ),
            shortcuts,
          }),
        );
        let repairError: string | undefined;
        if (repaired) {
          try {
            await window.aihub.setSettings(normalized);
          } catch (cause) {
            repairError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }
        set({
          ...normalized,
          hydrated: true,
          repairedShortcuts: repaired,
          syncError: repairError,
        });
        applyAppearance(normalized);
        saveBootstrap(normalized);
      } catch (cause) {
        set({
          hydrated: true,
          syncError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    applyImportedSettings: (settings) => {
      const normalized = withRendererDefaults(normalizeAppSettings(settings));
      set({ ...normalized, syncError: undefined });
      applyAppearance(normalized);
      saveBootstrap(normalized);
    },
    reset: () => commit({ ...DEFAULT_APP_SETTINGS, shortcuts: DEFAULT_SHORTCUTS }),
  };
});

export function resolveLocale(locale: LocaleMode): "zh-CN" | "en-US" {
  if (locale !== "system") return locale;
  return typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.dataset.theme =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  } else {
    root.dataset.theme = theme;
  }
}

export function applyAppearance(settings: AppSettingsPayload): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  applyTheme(settings.theme ?? "system");
  root.lang = resolveLocale(settings.locale ?? "system");
  root.dataset.density = settings.density ?? "comfortable";
  root.dataset.contentWidth = settings.contentWidth ?? "standard";
  root.dataset.codeWrap = settings.codeWrap ? "true" : "false";
  root.dataset.motion = settings.motion ?? "system";
  root.dataset.contrast = settings.contrastMode ?? "system";
}

export function settingsPayload(state: SettingsState): AppSettingsPayload {
  return {
    theme: state.theme,
    locale: state.locale,
    defaultProvider: state.defaultProvider,
    enabledProviders: state.enabledProviders,
    providerOrder: state.providerOrder,
    providerBackends: state.providerBackends,
    providerApiConfigs: state.providerApiConfigs,
    autoSyncWebHistory: state.autoSyncWebHistory,
    uiScale: state.uiScale,
    density: state.density,
    contentWidth: state.contentWidth,
    codeWrap: state.codeWrap,
    motion: state.motion,
    contrastMode: state.contrastMode,
    automaticBackup: state.automaticBackup,
    backupRetentionDays: state.backupRetentionDays,
    trashRetentionDays: state.trashRetentionDays,
    trayEnabled: state.trayEnabled,
    closeBehavior: state.closeBehavior,
    launchAtLogin: state.launchAtLogin,
    notificationPreferences: state.notificationPreferences,
    updatePolicy: state.updatePolicy,
    sidebarWidth: state.sidebarWidth,
    sidebarCollapsed: state.sidebarCollapsed,
    providerDrawerWidth: state.providerDrawerWidth,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
    shortcuts: state.shortcuts,
  };
}

function withRendererDefaults(
  settings: NormalizedAppSettings,
): NormalizedAppSettings & {
  shortcuts: Record<ShortcutAction, string>;
} {
  return {
    ...settings,
    shortcuts: {
      ...DEFAULT_SHORTCUTS,
      ...settings.shortcuts,
    } as Record<ShortcutAction, string>,
  };
}

export function normalizeShortcutRecord(
  shortcuts?: Record<string, string>,
): { shortcuts: Record<ShortcutAction, string>; repaired: boolean } {
  const result = { ...DEFAULT_SHORTCUTS };
  let repaired = false;
  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const raw = shortcuts?.[action];
    if (raw === undefined) continue;
    if (raw === "") {
      result[action] = "";
      continue;
    }
    const normalized = normalizeShortcutBinding(raw);
    if (normalized) result[action] = normalized;
    else repaired = true;
  }
  for (let pass = 0; pass < Object.keys(DEFAULT_SHORTCUTS).length; pass += 1) {
    const owners = new Map<string, ShortcutAction>();
    let changed = false;
    for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
      const binding = result[action];
      if (!binding) continue;
      const owner = owners.get(binding);
      if (!owner) {
        owners.set(binding, action);
        continue;
      }
      result[owner] = DEFAULT_SHORTCUTS[owner];
      result[action] = DEFAULT_SHORTCUTS[action];
      repaired = true;
      changed = true;
    }
    if (!changed) break;
  }
  return { shortcuts: result, repaired };
}

function loadBootstrap(): Partial<Pick<AppSettingsPayload, "theme" | "locale">> {
  try {
    const raw = localStorage.getItem(BOOTSTRAP_KEY);
    return raw ? (JSON.parse(raw) as AppSettingsPayload) : {};
  } catch {
    return {};
  }
}

function saveBootstrap(settings: AppSettingsPayload): void {
  try {
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ theme: settings.theme, locale: settings.locale }),
    );
  } catch {
    return;
  }
}

applyAppearance(initialSettings);
