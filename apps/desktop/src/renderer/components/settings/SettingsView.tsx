import { useEffect, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArchiveRestore,
  BookOpen,
  CircleCheck,
  Database,
  Download,
  FolderPlus,
  HardDriveDownload,
  GripVertical,
  Info,
  Keyboard,
  Languages,
  LogIn,
  Monitor,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  PROVIDER_LABELS,
  type DataImportPreview,
  type DataStorageSummary,
  type BackupManifestV1,
  type BackupRestorePreview,
  type ProviderId,
  type SettingsImportPreview,
  type UiScale,
  type TrashItem,
  type UpdateState,
} from "@aihub/core";
import { useI18n, type TranslationKey } from "../../i18n";
import {
  type SettingsSection,
  useAppStore,
  useSelectedConversation,
} from "../../stores/app-store";
import { confirmDialog, inputDialog } from "../../stores/dialog-store";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutAction,
  useSettingsStore,
} from "../../stores/settings-store";
import { useToastStore } from "../../stores/toast-store";
import {
  displayShortcut,
  findShortcutConflict,
  shortcutFromKeyboardEvent,
} from "../../utils/shortcuts";
import { Dialog } from "../shared/Dialog";

const NAV_ITEMS: Array<{
  id: SettingsSection;
  label: TranslationKey;
  icon: typeof Settings;
}> = [
  { id: "general", label: "settings.general", icon: Settings },
  { id: "appearance", label: "settings.appearance", icon: Monitor },
  { id: "providers", label: "settings.providers", icon: RefreshCw },
  { id: "conversations", label: "settings.conversations", icon: Tag },
  { id: "prompts", label: "settings.prompts", icon: Sparkles },
  { id: "knowledge", label: "settings.knowledge", icon: BookOpen },
  { id: "shortcuts", label: "settings.shortcuts", icon: Keyboard },
  { id: "data", label: "settings.data", icon: Database },
  { id: "about", label: "settings.about", icon: Info },
];

const BACKUP_REASON_KEYS: Record<
  BackupManifestV1["reason"],
  TranslationKey
> = {
  manual: "settings.backupReason.manual",
  scheduled: "settings.backupReason.scheduled",
  "pre-restore": "settings.backupReason.preRestore",
  "pre-reset": "settings.backupReason.preReset",
  "pre-update": "settings.backupReason.preUpdate",
};

const TRASH_TYPE_KEYS: Record<TrashItem["type"], TranslationKey> = {
  conversation: "settings.trashType.conversation",
  folder: "settings.trashType.folder",
  tag: "settings.trashType.tag",
  "system-prompt": "settings.trashType.prompt",
  document: "settings.trashType.document",
};

export function SettingsView() {
  const { t } = useI18n();
  const section = useAppStore((state) => state.settingsSection);
  const setSection = useAppStore((state) => state.setSettingsSection);
  const closeSettings = useAppStore((state) => state.closeSettings);
  const syncError = useSettingsStore((state) => state.syncError);
  const addToast = useToastStore((state) => state.addToast);

  useEffect(() => {
    if (syncError) {
      addToast(t("settings.saveFailed", { error: syncError }), "error");
    }
  }, [addToast, syncError, t]);

  return (
    <main
      data-testid="settings-view"
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full hover:bg-[var(--color-bg-hover)]"
          onClick={closeSettings}
          aria-label={t("settings.back")}
          title={t("settings.back")}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <h1 className="text-lg font-semibold">{t("settings.title")}</h1>
          {syncError && (
            <p className="text-xs text-[var(--color-danger-text)]">
              {t("settings.saveFailed", { error: syncError })}
            </p>
          )}
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label={t("settings.title")}
          className="overflow-y-auto border-r border-[var(--color-border)] p-3"
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                section === id
                  ? "bg-[var(--color-bg-active)] font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              }`}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={15} />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="min-h-0 overflow-y-auto px-8 py-7">
          <div className="mx-auto w-full max-w-[880px]">
            {section === "general" && <GeneralSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "providers" && <ProviderSection />}
            {section === "conversations" && <ConversationSection />}
            {section === "prompts" && <PromptSection />}
            {section === "knowledge" && <KnowledgeSection />}
            {section === "shortcuts" && <ShortcutSection />}
            {section === "data" && <DataSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </main>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          {description}
        </p>
      )}
    </header>
  );
}

function GeneralSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const providers = settings.providerOrder.filter((provider) =>
    settings.enabledProviders.includes(provider),
  );
  return (
    <>
      <SectionTitle title={t("settings.general")} />
      <div className="grid gap-5">
        <SelectSetting
          label={t("settings.language")}
          value={settings.locale}
          onChange={(value) =>
            settings.setLocale(value as "system" | "zh-CN" | "en-US")
          }
          options={[
            ["system", t("settings.language.system")],
            ["zh-CN", t("settings.language.zh")],
            ["en-US", t("settings.language.en")],
          ]}
          leading={<Languages size={16} />}
        />
        <SelectSetting
          label={t("settings.defaultProvider")}
          value={settings.defaultProvider ?? providers[0] ?? "chatgpt"}
          onChange={(value) => settings.setDefaultProvider(value as ProviderId)}
          options={providers.map((provider) => [
            provider,
            PROVIDER_LABELS[provider],
          ])}
        />
        <ToggleSetting
          label={t("settings.autoSync")}
          description={t("settings.autoSyncDescription")}
          checked={settings.autoSyncWebHistory}
          onChange={settings.setAutoSyncWebHistory}
        />
        <ToggleSetting
          label={t("settings.tray")}
          description={t("settings.trayDescription")}
          checked={settings.trayEnabled}
          onChange={settings.setTrayEnabled}
        />
        {settings.trayEnabled && (
          <SelectSetting
            label={t("settings.closeBehavior")}
            value={settings.closeBehavior}
            onChange={(value) =>
              settings.setCloseBehavior(
                value as "exit" | "minimize-to-tray",
              )
            }
            options={[
              ["exit", t("settings.closeBehavior.exit")],
              ["minimize-to-tray", t("settings.closeBehavior.tray")],
            ]}
          />
        )}
        <ToggleSetting
          label={t("settings.launchAtLogin")}
          checked={settings.launchAtLogin}
          onChange={settings.setLaunchAtLogin}
        />
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {t("settings.notifications")}
          </h3>
          <div className="grid gap-4">
            <ToggleSetting
              label={t("settings.notificationCompleted")}
              checked={settings.notificationPreferences.generationCompleted}
              onChange={(enabled) =>
                settings.setNotificationPreference(
                  "generationCompleted",
                  enabled,
                )
              }
            />
            <ToggleSetting
              label={t("settings.notificationFailed")}
              checked={settings.notificationPreferences.generationFailed}
              onChange={(enabled) =>
                settings.setNotificationPreference(
                  "generationFailed",
                  enabled,
                )
              }
            />
            <ToggleSetting
              label={t("settings.notificationSyncFailed")}
              checked={settings.notificationPreferences.syncFailed}
              onChange={(enabled) =>
                settings.setNotificationPreference("syncFailed", enabled)
              }
            />
            <ToggleSetting
              label={t("settings.notificationPreview")}
              description={t("settings.notificationPreviewDescription")}
              checked={settings.notificationPreferences.showPreview}
              onChange={(enabled) =>
                settings.setNotificationPreference("showPreview", enabled)
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}

function AppearanceSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  return (
    <>
      <SectionTitle title={t("settings.appearance")} />
      <div className="grid gap-5">
        <SelectSetting
          label={t("settings.theme")}
          value={settings.theme}
          onChange={(value) =>
            settings.setTheme(value as "system" | "dark" | "light")
          }
          options={[
            ["system", t("settings.theme.system")],
            ["dark", t("settings.theme.dark")],
            ["light", t("settings.theme.light")],
          ]}
        />
        <SelectSetting
          label={t("settings.uiScale")}
          value={String(settings.uiScale)}
          onChange={(value) => settings.setUiScale(Number(value) as UiScale)}
          options={[
            ["0.9", "90%"],
            ["1", "100%"],
            ["1.1", "110%"],
            ["1.25", "125%"],
          ]}
        />
        <SelectSetting
          label={t("settings.density")}
          value={settings.density}
          onChange={(value) =>
            settings.setDensity(value as "comfortable" | "compact")
          }
          options={[
            ["comfortable", t("settings.density.comfortable")],
            ["compact", t("settings.density.compact")],
          ]}
        />
        <SelectSetting
          label={t("settings.contentWidth")}
          value={settings.contentWidth}
          onChange={(value) =>
            settings.setContentWidth(
              value as "narrow" | "standard" | "wide",
            )
          }
          options={[
            ["narrow", `${t("settings.contentWidth.narrow")} · 760px`],
            ["standard", `${t("settings.contentWidth.standard")} · 860px`],
            ["wide", `${t("settings.contentWidth.wide")} · 1040px`],
          ]}
        />
        <ToggleSetting
          label={t("settings.codeWrap")}
          checked={settings.codeWrap}
          onChange={settings.setCodeWrap}
        />
        <SelectSetting
          label={t("settings.motion")}
          value={settings.motion}
          onChange={(value) =>
            settings.setMotion(value as "system" | "reduced" | "full")
          }
          options={[
            ["system", t("settings.motion.system")],
            ["reduced", t("settings.motion.reduced")],
            ["full", t("settings.motion.full")],
          ]}
        />
        <SelectSetting
          label={t("settings.contrast")}
          value={settings.contrastMode}
          onChange={(value) =>
            settings.setContrastMode(
              value as "system" | "standard" | "high",
            )
          }
          options={[
            ["system", t("settings.contrast.system")],
            ["standard", t("settings.contrast.standard")],
            ["high", t("settings.contrast.high")],
          ]}
        />
        <button
          type="button"
          className="justify-self-start rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
          onClick={settings.resetAppearance}
        >
          {t("settings.resetAppearance")}
        </button>
      </div>
    </>
  );
}

function ProviderSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const providers = useAppStore((state) => state.snapshot.providers);
  const addToast = useToastStore((state) => state.addToast);
  const [dragging, setDragging] = useState<ProviderId>();

  async function clearData(provider: ProviderId) {
    if (
      !(await confirmDialog({
        title: t("provider.clearDataTitle", {
          provider: PROVIDER_LABELS[provider],
        }),
        description: t("provider.clearDataDescription"),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await window.aihub.clearProviderSiteData(provider);
      addToast(
        t("provider.cleared", { provider: PROVIDER_LABELS[provider] }),
        "success",
      );
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  return (
    <>
      <SectionTitle
        title={t("settings.providers")}
        description={t("settings.providersDescription")}
      />
      <div className="grid gap-3">
        {settings.providerOrder.map((provider, index) => {
          const state = providers.find((entry) => entry.id === provider);
          const enabled = settings.enabledProviders.includes(provider);
          const status = state?.degraded
            ? t("provider.status.degraded")
            : !state?.authenticated
              ? t("provider.status.login")
              : state.ready
                ? t("provider.status.online")
                : t("provider.status.unavailable");
          return (
            <div
              key={provider}
              data-setting-row
              draggable
              onDragStart={() => setDragging(provider)}
              onDragEnd={() => setDragging(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging) settings.reorderProvider(dragging, provider);
                setDragging(undefined);
              }}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3"
            >
              <GripVertical
                size={16}
                className="cursor-grab text-[var(--color-text-tertiary)]"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
                  {state?.degraded ||
                  (state?.authenticated && !state.ready) ? (
                    <TriangleAlert
                      size={14}
                      className={
                        state?.degraded
                          ? "text-[var(--color-danger)]"
                          : "text-[var(--color-warning)]"
                      }
                      aria-hidden
                    />
                  ) : state?.authenticated && state.ready ? (
                    <CircleCheck
                      size={14}
                      className="text-[var(--color-online)]"
                      aria-hidden
                    />
                  ) : (
                    <LogIn
                      size={14}
                      className="text-[var(--color-offline)]"
                      aria-hidden
                    />
                  )}
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {status}
                  </span>
                  <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                    {state?.websiteVisible
                      ? t("provider.drawer.open")
                      : t("provider.drawer.closed")}
                  </span>
                </div>
                {state?.reason && (
                  <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">
                    {state.reason}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!state?.authenticated && !state?.degraded ? (
                    <SmallButton
                      label={t("provider.action.openLogin")}
                      onClick={() =>
                        void window.aihub.setProviderWebsiteVisible(
                          provider,
                          true,
                        )
                      }
                    />
                  ) : state?.degraded || !state?.ready ? (
                    <>
                      <SmallButton
                        label={t("provider.action.openRecovery")}
                        onClick={() =>
                          void window.aihub.setProviderWebsiteVisible(
                            provider,
                            true,
                          )
                        }
                      />
                      <SmallButton
                        label={t("provider.action.recheck")}
                        onClick={() =>
                          void window.aihub
                            .recoverProvider(provider)
                            .catch((cause) =>
                              addToast(errorText(cause), "error"),
                            )
                        }
                      />
                    </>
                  ) : (
                    <>
                      <SmallButton
                        label={t("provider.open")}
                        onClick={() =>
                          void window.aihub.setProviderWebsiteVisible(
                            provider,
                            true,
                          )
                        }
                      />
                      <SmallButton
                        label={t("provider.syncNow")}
                        onClick={() =>
                          void window.aihub
                            .syncWebHistory(provider)
                            .catch((cause) =>
                              addToast(errorText(cause), "error"),
                            )
                        }
                      />
                    </>
                  )}
                  <SmallButton
                    label={t("provider.clearData")}
                    danger
                    onClick={() => void clearData(provider)}
                  />
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1">
                  <IconButton
                    label={t("provider.moveUp")}
                    disabled={index === 0}
                    onClick={() => settings.moveProvider(provider, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    label={t("provider.moveDown")}
                    disabled={index === settings.providerOrder.length - 1}
                    onClick={() => settings.moveProvider(provider, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </div>
                <ProviderEnableSwitch
                  provider={provider}
                  enabled={enabled}
                  disabled={enabled && settings.enabledProviders.length === 1}
                  onChange={(next) =>
                    settings.setProviderEnabled(provider, next)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ConversationSection() {
  const { t } = useI18n();
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const createTag = useAppStore((state) => state.createTag);
  const deleteTag = useAppStore((state) => state.deleteTag);
  const addToast = useToastStore((state) => state.addToast);
  const [entryKind, setEntryKind] = useState<"folder" | "tag">();

  async function removeFolder(id: string) {
    if (
      await confirmDialog({
        title: t("settings.deleteFolderTitle"),
        description: t("settings.deleteFolderDescription"),
        destructive: true,
      })
    ) {
      if (await deleteFolder(id)) {
        addToast(t("toast.movedToTrash"), "success");
      }
    }
  }

  async function removeTag(id: string) {
    if (
      await confirmDialog({
        title: t("settings.deleteTagTitle"),
        description: t("settings.deleteTagDescription"),
        destructive: true,
      })
    ) {
      if (await deleteTag(id)) {
        addToast(t("toast.movedToTrash"), "success");
      }
    }
  }

  return (
    <>
      <SectionTitle title={t("settings.conversations")} />
      <OrganizationGroup
        title={t("settings.folders")}
        action={t("settings.newFolder")}
        icon={<FolderPlus size={14} />}
        onAdd={() => setEntryKind("folder")}
      >
        {folders.map((folder) => (
          <OrganizationChip
            key={folder.id}
            label={folder.name}
            onDelete={() => void removeFolder(folder.id)}
          />
        ))}
      </OrganizationGroup>
      <OrganizationGroup
        title={t("settings.tags")}
        action={t("settings.newTag")}
        icon={<Tag size={14} />}
        onAdd={() => setEntryKind("tag")}
      >
        {tags.map((tag) => (
          <OrganizationChip
            key={tag.id}
            label={tag.name}
            color={tag.color}
            onDelete={() => void removeTag(tag.id)}
          />
        ))}
      </OrganizationGroup>
      <NameEntryDialog
        open={Boolean(entryKind)}
        title={
          entryKind === "folder"
            ? t("settings.newFolder")
            : t("settings.newTag")
        }
        onClose={() => setEntryKind(undefined)}
        onSubmit={async (name) => {
          if (entryKind === "folder") {
            if (!(await createFolder(name))) return;
            addToast(t("toast.folderCreated"), "success");
          } else {
            if (!(await createTag(name, "#7ce6ae"))) return;
            addToast(t("toast.tagCreated"), "success");
          }
          setEntryKind(undefined);
        }}
      />
    </>
  );
}

function PromptSection() {
  const { t } = useI18n();
  const prompts = useAppStore((state) => state.systemPrompts);
  const setPromptModalOpen = useAppStore(
    (state) => state.setSystemPromptModalOpen,
  );
  return (
    <>
      <SectionTitle title={t("settings.prompts")} />
      <button
        type="button"
        className="mb-5 flex items-center gap-2 rounded-lg bg-[var(--color-send-bg)] px-4 py-2 font-semibold text-[var(--color-send-text)]"
        onClick={() => setPromptModalOpen(true)}
      >
        <Sparkles size={15} />
        {t("settings.openPromptManager")}
      </button>
      <div className="grid gap-2">
        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="rounded-xl border border-[var(--color-border)] p-3"
          >
            <div className="font-medium">{prompt.name}</div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {prompt.provider
                ? PROVIDER_LABELS[prompt.provider]
                : t("settings.defaultProvider")}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function KnowledgeSection() {
  const { t, locale } = useI18n();
  const documents = useAppStore((state) => state.documents);
  const addDocument = useAppStore((state) => state.addDocument);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const setConversationDocuments = useAppStore(
    (state) => state.setConversationDocuments,
  );
  const conversation = useSelectedConversation();

  async function remove(id: string) {
    if (
      await confirmDialog({
        title: t("settings.deleteDocumentTitle"),
        description: t("settings.deleteDocumentDescription"),
        destructive: true,
      })
    ) {
      if (await removeDocument(id)) {
        useToastStore.getState().addToast(t("toast.movedToTrash"), "success");
      }
    }
  }

  return (
    <>
      <SectionTitle title={t("settings.knowledge")} />
      <button
        type="button"
        className="mb-5 flex items-center gap-2 rounded-lg bg-[var(--color-send-bg)] px-4 py-2 font-semibold text-[var(--color-send-text)]"
        onClick={() => void addDocument()}
      >
        <Plus size={15} />
        {t("settings.addDocument")}
      </button>
      <div className="grid gap-2">
        {documents.map((document) => (
          <div
            key={document.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3"
          >
            <input
              type="checkbox"
              disabled={!conversation}
              checked={conversation?.documentIds.includes(document.id) ?? false}
              onChange={() => {
                if (!conversation) return;
                const next = conversation.documentIds.includes(document.id)
                  ? conversation.documentIds.filter((id) => id !== document.id)
                  : [...conversation.documentIds, document.id];
                void setConversationDocuments(conversation.id, next);
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{document.name}</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">
                {formatBytes(document.sizeBytes, locale)}
              </div>
            </div>
            <IconButton
              label={t("common.delete")}
              danger
              onClick={() => void remove(document.id)}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
      </div>
    </>
  );
}

function ShortcutSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const [recording, setRecording] = useState<ShortcutAction>();
  const [error, setError] = useState<string>();
  const labels = shortcutLabels(t);

  function record(action: ShortcutAction, event: KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(undefined);
      setError(undefined);
      return;
    }
    const binding = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!binding) {
      setError(t("settings.shortcutInvalid"));
      return;
    }
    const conflict = findShortcutConflict(
      settings.shortcuts,
      action,
      binding,
    ) as ShortcutAction | undefined;
    if (conflict) {
      setError(
        t("settings.shortcutConflict", { action: labels[conflict] }),
      );
      return;
    }
    settings.setShortcut(action, binding);
    setRecording(undefined);
    setError(undefined);
  }

  return (
    <>
      <SectionTitle
        title={t("settings.shortcuts")}
        description={t("settings.shortcutDescription")}
      />
      {error && (
        <div className="mb-3 rounded-lg bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}
      <div className="grid gap-2">
        {(Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).map((action) => (
          <div
            key={action}
            data-setting-row
            className="grid grid-cols-[minmax(0,1fr)_180px_auto_auto] items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--color-bg-hover)]"
          >
            <span className="text-sm">{labels[action]}</span>
            <button
              type="button"
              data-shortcut-recorder
              className="rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2 text-center font-mono text-xs"
              onClick={() => {
                setRecording((current) =>
                  current === action ? undefined : action,
                );
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (recording === action) record(action, event);
              }}
              onBlur={() => setRecording(undefined)}
              title={
                recording === action
                  ? t("settings.cancelRecording")
                  : labels[action]
              }
            >
              {recording === action
                ? t("settings.recording")
                : settings.shortcuts[action]
                  ? displayShortcut(settings.shortcuts[action])
                  : t("settings.recordShortcut")}
            </button>
            <SmallButton
              label={t("common.reset")}
              onClick={() => settings.resetShortcut(action)}
            />
            <SmallButton
              label={t("common.clear")}
              onClick={() => settings.clearShortcut(action)}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-4 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
        onClick={settings.resetShortcuts}
      >
        {t("settings.resetAllShortcuts")}
      </button>
    </>
  );
}

function DataSection() {
  const { t, locale } = useI18n();
  const settings = useSettingsStore();
  const addToast = useToastStore((state) => state.addToast);
  const refreshLibraryData = useAppStore((state) => state.refreshLibraryData);
  const refreshSystemPrompts = useAppStore(
    (state) => state.refreshSystemPrompts,
  );
  const [summary, setSummary] = useState<DataStorageSummary>();
  const [backups, setBackups] = useState<BackupManifestV1[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataBusy, setDataBusy] = useState(false);
  const [preview, setPreview] = useState<SettingsImportPreview>();
  const [restorePreview, setRestorePreview] =
    useState<BackupRestorePreview>();
  const [dataImportPreview, setDataImportPreview] =
    useState<DataImportPreview>();
  const [importJson, setImportJson] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      window.aihub.getStorageSummary(),
      window.aihub.listBackups(),
      window.aihub.listTrash(),
    ])
      .then(([storage, backupItems, trashItems]) => {
        if (!active) return;
        setSummary(storage);
        setBackups(backupItems);
        setTrash(trashItems);
      })
      .catch((cause) => addToast(errorText(cause), "error"))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addToast]);

  async function refreshDataControls() {
    const [storage, backupItems, trashItems] = await Promise.all([
      window.aihub.getStorageSummary(),
      window.aihub.listBackups(),
      window.aihub.listTrash(),
    ]);
    setSummary(storage);
    setBackups(backupItems);
    setTrash(trashItems);
  }

  async function createBackup() {
    setDataBusy(true);
    try {
      await window.aihub.createBackup();
      await refreshDataControls();
      addToast(t("settings.backupCreated"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    } finally {
      setDataBusy(false);
    }
  }

  async function deleteBackup(backup: BackupManifestV1) {
    if (
      !(await confirmDialog({
        title: t("settings.deleteBackupTitle"),
        description: t("settings.deleteBackupDescription"),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await window.aihub.deleteBackup(backup.id);
      await refreshDataControls();
      addToast(t("settings.backupDeleted"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function previewRestore(backup: BackupManifestV1) {
    try {
      setRestorePreview(await window.aihub.previewBackupRestore(backup.id));
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function applyRestore() {
    if (!restorePreview) return;
    setDataBusy(true);
    try {
      await window.aihub.restoreBackup(restorePreview.backup.id);
      setRestorePreview(undefined);
      addToast(t("settings.restoreScheduled"), "success", 8_000);
    } catch (cause) {
      addToast(errorText(cause), "error");
      setDataBusy(false);
    }
  }

  async function restoreTrashItem(item: TrashItem) {
    try {
      await window.aihub.restoreTrash(item.type, item.id);
      await Promise.all([
        refreshDataControls(),
        refreshLibraryData(),
        refreshSystemPrompts(),
      ]);
      addToast(t("settings.trashRestored"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function purgeTrashItem(item: TrashItem) {
    if (
      !(await confirmDialog({
        title: t("settings.purgeTrashTitle"),
        description: t("settings.purgeTrashDescription"),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await window.aihub.purgeTrash(item.type, item.id);
      await refreshDataControls();
      addToast(t("settings.trashPurged"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function emptyTrash() {
    if (
      !(await confirmDialog({
        title: t("settings.emptyTrashTitle"),
        description: t("settings.emptyTrashDescription"),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await window.aihub.emptyTrash();
      await refreshDataControls();
      addToast(t("settings.trashEmptied"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function resetData(
    scope: "local-content" | "provider-sessions" | "everything",
  ) {
    const confirmation = await inputDialog({
      title: t("settings.resetDataTitle"),
      description:
        scope === "local-content"
          ? t("settings.resetLocalContentDescription")
          : scope === "provider-sessions"
            ? t("settings.resetProviderSessionsDescription")
            : t("settings.resetEverythingDescription"),
      placeholder: "LLM Workbench",
      confirmLabel: t("common.clear"),
    });
    if (confirmation !== "LLM Workbench") {
      if (confirmation !== undefined) {
        addToast(t("settings.resetConfirmationMismatch"), "warning");
      }
      return;
    }
    try {
      await window.aihub.resetData({
        scope,
        confirmation: "LLM Workbench",
        createBackup: scope !== "provider-sessions",
      });
      addToast(t("settings.resetScheduled"), "success", 8_000);
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function previewImport(json: string) {
    try {
      const next = await window.aihub.previewSettingsImport(json);
      setImportJson(json);
      setPreview(next);
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function applyImport() {
    try {
      const imported = await window.aihub.importSettings(importJson);
      settings.applyImportedSettings(imported);
      setPreview(undefined);
      addToast(t("settings.imported"), "success");
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  async function previewDataImport() {
    setDataBusy(true);
    try {
      const next = await window.aihub.previewDataImport();
      if (!next.canceled) setDataImportPreview(next);
    } catch (cause) {
      addToast(errorText(cause), "error");
    } finally {
      setDataBusy(false);
    }
  }

  async function applyDataImport() {
    const token = dataImportPreview?.token;
    if (!token) return;
    setDataBusy(true);
    try {
      const result = await window.aihub.importAllData(token);
      setDataImportPreview(undefined);
      await Promise.all([
        refreshDataControls(),
        refreshLibraryData(),
        refreshSystemPrompts(),
      ]);
      addToast(
        t("settings.dataImported", {
          conversations: result.conversationCount,
          messages: result.messageCount,
        }),
        "success",
      );
    } catch (cause) {
      addToast(errorText(cause), "error");
    } finally {
      setDataBusy(false);
    }
  }

  async function resetAll() {
    if (
      await confirmDialog({
        title: t("settings.resetAllTitle"),
        description: t("settings.resetAllDescription"),
        destructive: true,
      })
    ) {
      settings.reset();
      addToast(t("toast.settingsReset"), "success");
    }
  }

  return (
    <>
      <SectionTitle title={t("settings.data")} />
      <div className="mb-6 grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 sm:grid-cols-2">
        <Metric
          label={t("settings.storageLocation")}
          value={loading ? t("common.loading") : (summary?.userDataPath ?? "—")}
          wide
        />
        <Metric
          label={t("settings.databaseSize")}
          value={formatBytes(summary?.databaseBytes ?? 0, locale)}
        />
        <Metric
          label={t("settings.conversationCount")}
          value={(summary?.conversationCount ?? 0).toLocaleString(locale)}
        />
        <Metric
          label={t("settings.messageCount")}
          value={(summary?.messageCount ?? 0).toLocaleString(locale)}
        />
        <Metric
          label={t("settings.documentCount")}
          value={(summary?.documentCount ?? 0).toLocaleString(locale)}
        />
        <Metric
          label={t("settings.indexedSize")}
          value={(summary?.indexedCharacterCount ?? 0).toLocaleString(locale)}
        />
        <Metric
          label={t("settings.documentBytes")}
          value={formatBytes(summary?.documentBytes ?? 0, locale)}
        />
      </div>
      <section className="mb-8 rounded-xl border border-[var(--color-border)] p-4">
        <h3 className="text-base font-semibold">{t("settings.backupTitle")}</h3>
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
          {t("settings.backupDescription")}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ToggleSetting
            label={t("settings.automaticBackup")}
            checked={settings.automaticBackup}
            onChange={settings.setAutomaticBackup}
          />
          <SelectSetting
            label={t("settings.backupRetention")}
            value={String(settings.backupRetentionDays)}
            onChange={(value) =>
              settings.setBackupRetentionDays(
                Number(value) as 7 | 30 | 90 | 365,
              )
            }
            options={([7, 30, 90, 365] as const).map((days) => [
              String(days),
              t("settings.retentionDays", { count: days }),
            ])}
          />
          <SelectSetting
            label={t("settings.trashRetention")}
            value={String(settings.trashRetentionDays)}
            onChange={(value) =>
              settings.setTrashRetentionDays(
                Number(value) as 0 | 7 | 30 | 90,
              )
            }
            options={[
              ["7", t("settings.retentionDays", { count: 7 })],
              ["30", t("settings.retentionDays", { count: 30 })],
              ["90", t("settings.retentionDays", { count: 90 })],
              ["0", t("settings.retentionForever")],
            ]}
          />
        </div>
        <button
          type="button"
          className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-send-bg)] px-3 py-2 text-sm font-semibold text-[var(--color-send-text)] disabled:opacity-40"
          disabled={dataBusy}
          onClick={() => void createBackup()}
        >
          <HardDriveDownload size={15} />
          {t("settings.createBackup")}
        </button>
        <div className="mt-4 grid gap-2">
          {backups.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t("settings.noBackups")}
            </p>
          ) : (
            backups.map((backup) => (
              <div
                key={backup.id}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-bg-soft)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {new Date(backup.createdAt).toLocaleString(locale)}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {t(BACKUP_REASON_KEYS[backup.reason])} ·{" "}
                    {formatBytes(backup.databaseBytes, locale)}
                    {" · "}
                    {backup.conversationCount.toLocaleString(locale)}{" "}
                    {t("settings.conversationCount")}
                  </p>
                </div>
                <SmallButton
                  label={t("settings.restoreBackup")}
                  onClick={() => void previewRestore(backup)}
                />
                <SmallButton
                  label={t("settings.deleteBackup")}
                  danger
                  onClick={() => void deleteBackup(backup)}
                />
              </div>
            ))
          )}
        </div>
      </section>
      <section className="mb-8 rounded-xl border border-[var(--color-border)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">
              {t("settings.trashTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {t("settings.trashDescription")}
            </p>
          </div>
          {trash.length > 0 && (
            <SmallButton
              label={t("settings.emptyTrash")}
              danger
              onClick={() => void emptyTrash()}
            />
          )}
        </div>
        <div className="mt-4 grid gap-2">
          {trash.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {t("settings.noTrash")}
            </p>
          ) : (
            trash.map((item) => {
              const purgeAt =
                settings.trashRetentionDays > 0
                  ? new Date(
                      new Date(item.deletedAt).getTime() +
                        settings.trashRetentionDays * 24 * 60 * 60 * 1_000,
                    ).toISOString()
                  : undefined;
              return (
                <div
                  key={`${item.type}:${item.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-bg-soft)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t(TRASH_TYPE_KEYS[item.type])} ·{" "}
                      {new Date(item.deletedAt).toLocaleString(locale)}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {purgeAt
                        ? t("settings.trashExpiresAt", {
                            date: new Date(purgeAt).toLocaleString(locale),
                          })
                        : t("settings.trashKeptForever")}
                    </p>
                  </div>
                  <SmallButton
                    label={t("settings.restoreTrash")}
                    onClick={() => void restoreTrashItem(item)}
                  />
                  <SmallButton
                    label={t("settings.purgeTrash")}
                    danger
                    onClick={() => void purgeTrashItem(item)}
                  />
                </div>
              );
            })
          )}
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          icon={<Database size={15} />}
          label={t("settings.openDataFolder")}
          onClick={() =>
            void window.aihub.openDataFolder().catch((cause) =>
              addToast(errorText(cause), "error"),
            )
          }
        />
        <ActionButton
          icon={<Download size={15} />}
          label={t("settings.exportAll")}
          onClick={() =>
            void window.aihub
              .exportAllData()
              .then((result) => {
                if (!result.canceled) {
                  addToast(
                    t("settings.exported", {
                      count: result.conversationCount ?? 0,
                    }),
                    "success",
                  );
                }
              })
              .catch((cause) => addToast(errorText(cause), "error"))
          }
        />
        <ActionButton
          icon={<Upload size={15} />}
          label={t("settings.importAll")}
          onClick={() => void previewDataImport()}
        />
        <ActionButton
          icon={<Download size={15} />}
          label={t("settings.exportSettings")}
          onClick={() =>
            void window.aihub
              .exportSettings()
              .then((json) =>
                downloadText("aihub-settings.json", json, "application/json"),
              )
              .catch((cause) => addToast(errorText(cause), "error"))
          }
        />
        <ActionButton
          icon={<Upload size={15} />}
          label={t("settings.importSettings")}
          onClick={() =>
            pickTextFile(".json", previewImport, (cause) =>
              addToast(errorText(cause), "error"),
            )
          }
        />
        <ActionButton
          icon={<Upload size={15} />}
          label={t("settings.importConversation")}
          onClick={() =>
            pickTextFile(".json", async (json) => {
              await window.aihub.importConversation(json);
              addToast(t("settings.importedConversation"), "success");
            }, (cause) => addToast(errorText(cause), "error"))
          }
        />
      </div>
      <button
        type="button"
        className="mt-8 rounded-lg border border-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]"
        onClick={() => void resetAll()}
      >
        {t("settings.resetAll")}
      </button>
      <div className="mt-8 flex flex-wrap gap-2">
        <ActionButton
          icon={<Trash2 size={15} />}
          label={t("settings.resetLocalContent")}
          onClick={() => void resetData("local-content")}
        />
        <ActionButton
          icon={<Trash2 size={15} />}
          label={t("settings.resetProviderSessions")}
          onClick={() => void resetData("provider-sessions")}
        />
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]"
          onClick={() => void resetData("everything")}
        >
          <Trash2 size={15} />
          {t("settings.resetEverything")}
        </button>
      </div>
      <Dialog
        open={Boolean(dataImportPreview)}
        onClose={() => setDataImportPreview(undefined)}
        title={t("settings.previewDataImport")}
        description={t("settings.dataImportDescription")}
        widthClass="w-[min(680px,calc(100vw-48px))]"
      >
        {dataImportPreview && (
          <>
            <p className="mb-3 text-sm font-medium">
              {dataImportPreview.fileName}
            </p>
            <div className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 text-sm sm:grid-cols-2">
              <Metric
                label={t("settings.conversationCount")}
                value={(dataImportPreview.conversationCount ?? 0).toLocaleString(
                  locale,
                )}
              />
              <Metric
                label={t("settings.messageCount")}
                value={(dataImportPreview.messageCount ?? 0).toLocaleString(
                  locale,
                )}
              />
              <Metric
                label={t("settings.folders")}
                value={(dataImportPreview.folderCount ?? 0).toLocaleString(
                  locale,
                )}
              />
              <Metric
                label={t("settings.tags")}
                value={(dataImportPreview.tagCount ?? 0).toLocaleString(locale)}
              />
              <Metric
                label={t("settings.prompts")}
                value={(
                  dataImportPreview.systemPromptCount ?? 0
                ).toLocaleString(locale)}
              />
              <Metric
                label={t("settings.dataImportConflicts")}
                value={(dataImportPreview.conflictCount ?? 0).toLocaleString(
                  locale,
                )}
              />
              <Metric
                label={t("settings.dataImportIgnoredDocuments")}
                value={(
                  dataImportPreview.ignoredKnowledgeDocumentCount ?? 0
                ).toLocaleString(locale)}
              />
              <Metric
                label={t("settings.dataImportAdjustedDefaults")}
                value={(
                  dataImportPreview.adjustedDefaultPromptCount ?? 0
                ).toLocaleString(locale)}
              />
            </div>
            {dataImportPreview.warnings?.map((warning) => (
              <p
                key={warning}
                className="mt-3 rounded-lg bg-[var(--color-warning-bg)] px-3 py-2 text-xs"
              >
                {warning}
              </p>
            ))}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <SmallButton
            label={t("common.cancel")}
            onClick={() => setDataImportPreview(undefined)}
          />
          <button
            type="button"
            disabled={dataBusy || !dataImportPreview?.token}
            className="rounded-lg bg-[var(--color-send-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-send-text)] disabled:opacity-40"
            onClick={() => void applyDataImport()}
          >
            {t("common.confirm")}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(preview)}
        onClose={() => setPreview(undefined)}
        title={t("settings.previewImport")}
        widthClass="w-[min(680px,calc(100vw-48px))]"
      >
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          {preview?.changes.length
            ? t("settings.importChanges", { count: preview.changes.length })
            : t("settings.importNoChanges")}
        </p>
        {preview?.ignoredKeys.length ? (
          <p className="mb-3 rounded-lg bg-[var(--color-warning-bg)] px-3 py-2 text-xs">
            {t("settings.ignoredKeys", {
              keys: preview.ignoredKeys.join(", "),
            })}
          </p>
        ) : null}
        {preview?.warnings.map((warning) => (
          <p
            key={warning}
            className="mb-3 rounded-lg bg-[var(--color-warning-bg)] px-3 py-2 text-xs"
          >
            {t("settings.importWarning", { warning })}
          </p>
        ))}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)]">
          {preview?.changes.length ? (
            <div className="grid grid-cols-[140px_1fr_1fr] gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold">
              <span />
              <span>{t("settings.beforeValue")}</span>
              <span>{t("settings.afterValue")}</span>
            </div>
          ) : null}
          {preview?.changes.map((change) => (
            <div
              key={change.key}
              className="grid grid-cols-[140px_1fr_1fr] gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs last:border-b-0"
            >
              <strong>{change.key}</strong>
              <span className="break-all text-[var(--color-text-secondary)]">
                {JSON.stringify(change.before)}
              </span>
              <span className="break-all text-[var(--color-text-secondary)]">
                {JSON.stringify(change.after)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <SmallButton
            label={t("common.cancel")}
            onClick={() => setPreview(undefined)}
          />
          <button
            type="button"
            className="rounded-lg bg-[var(--color-send-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-send-text)]"
            onClick={() => void applyImport()}
          >
            {t("common.confirm")}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(restorePreview)}
        onClose={() => setRestorePreview(undefined)}
        title={t("settings.restoreBackupTitle")}
        description={t("settings.restoreBackupDescription")}
        widthClass="w-[min(620px,calc(100vw-48px))]"
      >
        {restorePreview && (
          <>
            <div className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 text-sm sm:grid-cols-2">
              <Metric
                label={t("settings.conversationCount")}
                value={`${restorePreview.current.conversationCount.toLocaleString(locale)} → ${restorePreview.backup.conversationCount.toLocaleString(locale)}`}
              />
              <Metric
                label={t("settings.messageCount")}
                value={`${restorePreview.current.messageCount.toLocaleString(locale)} → ${restorePreview.backup.messageCount.toLocaleString(locale)}`}
              />
              <Metric
                label={t("settings.documentCount")}
                value={`${restorePreview.current.documentCount.toLocaleString(locale)} → ${restorePreview.backup.documentCount.toLocaleString(locale)}`}
              />
              <Metric
                label={t("settings.databaseSize")}
                value={formatBytes(
                  restorePreview.backup.databaseBytes,
                  locale,
                )}
              />
            </div>
            {restorePreview.warnings.map((warning) => (
              <p
                key={warning}
                className="mt-3 rounded-lg bg-[var(--color-warning-bg)] px-3 py-2 text-xs"
              >
                {warning}
              </p>
            ))}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <SmallButton
            label={t("common.cancel")}
            onClick={() => setRestorePreview(undefined)}
          />
          <button
            type="button"
            disabled={dataBusy}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={() => void applyRestore()}
          >
            <ArchiveRestore size={15} />
            {t("settings.restoreBackup")}
          </button>
        </div>
      </Dialog>
    </>
  );
}

function AboutSection() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const addToast = useToastStore((state) => state.addToast);
  const [update, setUpdate] = useState<UpdateState>();

  useEffect(() => {
    void window.aihub
      .getUpdateState()
      .then(setUpdate)
      .catch((cause) => addToast(errorText(cause), "error"));
    return window.aihub.onUpdateState(setUpdate);
  }, [addToast]);

  async function runUpdateAction(
    action: "check" | "download" | "install",
  ) {
    try {
      if (action === "install") {
        await window.aihub.installUpdate();
        return;
      }
      setUpdate(
        action === "check"
          ? await window.aihub.checkForUpdates()
          : await window.aihub.downloadUpdate(),
      );
    } catch (cause) {
      addToast(errorText(cause), "error");
    }
  }

  const statusText =
    update?.status === "checking"
      ? t("settings.update.checking")
      : update?.status === "available"
        ? t("settings.update.available", {
            version: update.availableVersion ?? "—",
          })
        : update?.status === "downloading"
          ? t("settings.update.downloading")
          : update?.status === "downloaded"
            ? t("settings.update.downloaded")
            : update?.status === "not-available"
              ? t("settings.update.current")
              : update?.status === "error"
                ? t("settings.update.error", {
                    error: update.error ?? t("common.failed"),
                  })
                : "";
  return (
    <>
      <SectionTitle
        title={t("settings.about")}
        description={t("settings.aboutDescription")}
      />
      <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-5 text-sm leading-6 text-[var(--color-text-secondary)]">
        <p>LLM Workbench {update?.currentVersion ?? "0.1.0"}</p>
        <p>{t("settings.localDataDescription")}</p>
      </div>
      <div className="mt-5 grid gap-4 rounded-xl border border-[var(--color-border)] p-5">
        <SelectSetting
          label={t("settings.updatePolicy")}
          value={settings.updatePolicy}
          onChange={(value) =>
            settings.setUpdatePolicy(
              value as "manual" | "notify" | "auto-download",
            )
          }
          options={[
            ["manual", t("settings.update.manual")],
            ["notify", t("settings.update.notify")],
            ["auto-download", t("settings.update.autoDownload")],
          ]}
        />
        {statusText && (
          <p
            aria-live="polite"
            className="text-sm text-[var(--color-text-secondary)]"
          >
            {statusText}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={<RefreshCw size={15} />}
            label={t("settings.checkUpdates")}
            onClick={() => void runUpdateAction("check")}
          />
          {update?.status === "available" && (
            <ActionButton
              icon={<Download size={15} />}
              label={t("settings.downloadUpdate")}
              onClick={() => void runUpdateAction("download")}
            />
          )}
          {update?.status === "downloaded" && (
            <ActionButton
              icon={<ArchiveRestore size={15} />}
              label={t("settings.installUpdate")}
              onClick={() => void runUpdateAction("install")}
            />
          )}
        </div>
      </div>
    </>
  );
}

function SelectSetting({
  label,
  value,
  options,
  onChange,
  leading,
}: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (value: string) => void;
  leading?: React.ReactNode;
}) {
  return (
    <label data-setting-row>
      <span className="mb-2 flex items-center gap-2 text-sm font-medium">
        {leading}
        {label}
      </span>
      <select
        className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      data-setting-row
      className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3 text-sm"
    >
      <span>
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function OrganizationGroup({
  title,
  action,
  icon,
  onAdd,
  children,
}: {
  title: string;
  action: string;
  icon: React.ReactNode;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-bg-hover)]"
          onClick={onAdd}
        >
          {icon}
          {action}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function OrganizationChip({
  label,
  color,
  onDelete,
}: {
  label: string;
  color?: string;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <span
      className="flex items-center gap-2 rounded-full bg-[var(--color-bg-inset)] px-3 py-1.5 text-xs"
      style={color ? { color, background: `${color}22` } : undefined}
    >
      {label}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("organization.deleteLabel", { name: label })}
        title={t("organization.deleteLabel", { name: label })}
      >
        <Trash2 size={12} />
      </button>
    </span>
  );
}

function NameEntryDialog({
  open,
  title,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      widthClass="w-[min(440px,calc(100vw-48px))]"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onSubmit(name.trim());
        }}
      >
        <label className="block text-sm">
          <span className="mb-2 block font-medium">{t("settings.name")}</span>
          <input
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <SmallButton label={t("common.cancel")} onClick={onClose} />
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-[var(--color-send-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-send-text)] disabled:opacity-40"
          >
            {t("common.confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ProviderEnableSwitch({
  provider,
  enabled,
  disabled,
  onChange,
}: {
  provider: ProviderId;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const descriptionId = `provider-new-entry-${provider}`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-right">
        <span className="block whitespace-nowrap text-xs font-medium">
          {t("provider.newEntry")}
        </span>
        <span
          id={descriptionId}
          className="sr-only"
        >
          {t("provider.newEntryDescription")}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={descriptionId}
        aria-label={`${t("provider.newEntry")} ${PROVIDER_LABELS[provider]}`}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${
          enabled
            ? "border-[var(--color-send-bg)] bg-[var(--color-send-bg)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-bg-inset)]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function SmallButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rounded-lg border px-2.5 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] ${
        danger
          ? "border-[var(--color-danger-bg)] text-[var(--color-danger-text)]"
          : "border-[var(--color-border)]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`grid size-8 place-items-center rounded-lg hover:bg-[var(--color-bg-hover)] disabled:opacity-30 ${
        danger ? "text-[var(--color-danger-text)]" : ""
      }`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function Metric({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium" title={value}>
        {value}
      </div>
    </div>
  );
}

function shortcutLabels(
  t: (key: TranslationKey) => string,
): Record<ShortcutAction, string> {
  return {
    focusSearch: t("shortcuts.focusSearch"),
    newConversation: t("shortcuts.newConversation"),
    toggleSidebar: t("shortcuts.toggleSidebar"),
    toggleProvider: t("shortcuts.toggleProvider"),
    toggleTheme: t("shortcuts.toggleTheme"),
    copyLastResponse: t("shortcuts.copyLastResponse"),
    previousConversation: t("shortcuts.previousConversation"),
    nextConversation: t("shortcuts.nextConversation"),
    showShortcutHelp: t("shortcuts.showShortcutHelp"),
  };
}

function formatBytes(bytes: number, locale: string): string {
  const format = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${format(bytes / 1024)} KB`;
  return `${format(bytes / 1024 / 1024)} MB`;
}

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickTextFile(
  accept: string,
  onText: (text: string) => Promise<void>,
  onError: (cause: unknown) => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void file.text().then(onText).catch(onError);
  };
  input.click();
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
