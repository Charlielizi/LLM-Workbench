import {
  PROVIDER_IDS,
  type AppSettingsPayload,
  type ProviderId,
} from "./types";

export const DEFAULT_APP_SETTINGS = {
  theme: "system",
  locale: "system",
  defaultProvider: null,
  enabledProviders: [...PROVIDER_IDS],
  providerOrder: [...PROVIDER_IDS],
  providerBackends: {},
  providerApiConfigs: {},
  autoSyncWebHistory: true,
  uiScale: 1,
  density: "comfortable",
  contentWidth: "standard",
  codeWrap: false,
  motion: "system",
  sidebarWidth: 270,
  sidebarCollapsed: false,
  providerDrawerWidth: 520,
  hasCompletedOnboarding: false,
  shortcuts: {},
} as const satisfies AppSettingsPayload;

export type NormalizedAppSettings = Required<AppSettingsPayload>;

export function normalizeAppSettings(
  settings: AppSettingsPayload,
  base: AppSettingsPayload = {},
): NormalizedAppSettings {
  const merged = { ...DEFAULT_APP_SETTINGS, ...base, ...settings };
  const providerOrder = normalizeProviderOrder(merged.providerOrder);
  const enabledProviders = normalizeEnabledProviders(
    merged.enabledProviders,
    providerOrder,
  );
  const defaultProvider =
    merged.defaultProvider && enabledProviders.includes(merged.defaultProvider)
      ? merged.defaultProvider
      : enabledProviders[0] ?? null;

  return {
    theme: merged.theme,
    locale: merged.locale,
    defaultProvider,
    enabledProviders,
    providerOrder,
    providerBackends: merged.providerBackends ?? {},
    providerApiConfigs: merged.providerApiConfigs ?? {},
    autoSyncWebHistory: merged.autoSyncWebHistory,
    uiScale: merged.uiScale,
    density: merged.density,
    contentWidth: merged.contentWidth,
    codeWrap: merged.codeWrap,
    motion: merged.motion,
    sidebarWidth: merged.sidebarWidth,
    sidebarCollapsed: merged.sidebarCollapsed,
    providerDrawerWidth: merged.providerDrawerWidth,
    hasCompletedOnboarding: merged.hasCompletedOnboarding,
    shortcuts: { ...(base.shortcuts ?? {}), ...(settings.shortcuts ?? {}) },
  };
}

function normalizeProviderOrder(order?: ProviderId[]): ProviderId[] {
  const known = new Set<ProviderId>(PROVIDER_IDS);
  const result: ProviderId[] = [];
  for (const provider of order ?? []) {
    if (known.has(provider) && !result.includes(provider)) result.push(provider);
  }
  for (const provider of PROVIDER_IDS) {
    if (!result.includes(provider)) result.push(provider);
  }
  return result;
}

function normalizeEnabledProviders(
  enabled: ProviderId[] | undefined,
  order: ProviderId[],
): ProviderId[] {
  const requested = new Set(enabled ?? PROVIDER_IDS);
  const result = order.filter((provider) => requested.has(provider));
  return result.length > 0 ? result : [...order];
}
