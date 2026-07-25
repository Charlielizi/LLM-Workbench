import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  ArrowRightLeft,
  CheckSquare,
  Download,
  FolderInput,
  Moon,
  PanelLeft,
  Pin,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import type { ProviderId } from "@aihub/core";
import { ConversationList } from "../sidebar/ConversationList";
import {
  ProviderFilterTabs,
  type ProviderFilter,
} from "../sidebar/ProviderFilterTabs";
import { SidebarSearch } from "../sidebar/SidebarSearch";
import { useConversationSearch } from "../../hooks/useConversationSearch";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useToastStore } from "../../stores/toast-store";
import { useI18n } from "../../i18n";
import { Dialog } from "../shared/Dialog";
import { confirmDialog, inputDialog } from "../../stores/dialog-store";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;

export function Sidebar() {
  const { t } = useI18n();
  const [providerFilter, setProviderFilter] =
    useState<ProviderFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkTransferTarget, setBulkTransferTarget] =
    useState<ProviderId>("chatgpt");
  const { query, setQuery } = useConversationSearch();
  const snapshotConversations = useAppStore(
    (state) => state.snapshot.conversations,
  );
  const searchResults = useAppStore((state) => state.searchResults);
  const createConversation = useAppStore(
    (state) => state.createConversation,
  );
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const bulkConversationAction = useAppStore(
    (state) => state.bulkConversationAction,
  );
  const collapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarWidth = useSettingsStore(
    (state) => state.setSidebarWidth,
  );
  const setSidebarCollapsed = useSettingsStore(
    (state) => state.setSidebarCollapsed,
  );
  const openSettings = useAppStore((state) => state.openSettings);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const providerBackends = useSettingsStore((state) => state.providerBackends);
  const providerOrder = useSettingsStore((state) => state.providerOrder);
  const enabledProviders = useSettingsStore((state) => state.enabledProviders);
  const defaultProvider = useSettingsStore(
    (state) => state.defaultProvider ?? state.enabledProviders[0] ?? "chatgpt",
  );
  const visibleProviders = providerOrder.filter((provider) =>
    enabledProviders.includes(provider),
  );
  const dragStart = useRef<{ x: number; width: number } | undefined>(
    undefined,
  );
  const conversations = (searchResults ?? snapshotConversations).filter(
    (conversation) =>
      (providerFilter === "all" ||
        conversation.provider === providerFilter) &&
      (folderFilter === "all" ||
        (folderFilter === "none"
          ? !conversation.folderId
          : conversation.folderId === folderFilter)),
  );
  const selectedConversationIds = [...selectedIds];

  async function syncWebHistory() {
    if (syncingHistory) return;
    setSyncingHistory(true);
    try {
      const providers = providerFilter === "all"
        ? visibleProviders.filter(
            (provider) => (providerBackends[provider] ?? "web") === "web",
          )
        : [providerFilter];
      const settled = await Promise.allSettled(
        providers.map((provider) => window.aihub.syncWebHistory(provider)),
      );
      const results = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const discovered = results.reduce(
        (total, result) => total + result.discovered,
        0,
      );
      const created = results.reduce(
        (total, result) => total + result.created,
        0,
      );
      const failures = settled.length - results.length;
      useToastStore.getState().addToast(
        `${t("toast.syncResult", { discovered, created })}${
          failures ? t("toast.syncFailures", { count: failures }) : ""
        }.`,
        failures ? "error" : "success",
      );
    } catch (error) {
      useToastStore.getState().addToast(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      setSyncingHistory(false);
    }
  }

  function finishBulkMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    for (const conversationId of selectedConversationIds) {
      const conversation = snapshotConversations.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) continue;
      const markdown = await window.aihub.exportConversation(
        conversationId,
        "markdown",
      );
      downloadText(
        `${safeFileName(conversation.title)}.md`,
        markdown,
        "text/markdown",
      );
    }
  }

  async function assignBulkFolder() {
    const name = await inputDialog({
      title: t("conversation.moveFolder"),
      description: t("conversation.folderDescription", {
        folders: folders.map((folder) => folder.name).join(", ") || "—",
      }),
      allowEmpty: true,
    });
    if (name === undefined) return;
    const folder = folders.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    await bulkConversationAction({
      action: "set-folder",
      conversationIds: selectedConversationIds,
      folderId: folder?.id ?? null,
    });
  }

  async function assignBulkTags() {
    const value = await inputDialog({
      title: t("conversation.setTags"),
      description: t("conversation.tagsDescription", {
        tags: tags.map((tag) => tag.name).join(", ") || "—",
      }),
      allowEmpty: true,
    });
    if (value === undefined) return;
    const names = value
      .split(/[,，]/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    await bulkConversationAction({
      action: "set-tags",
      conversationIds: selectedConversationIds,
      tagIds: tags
        .filter((tag) => names.includes(tag.name.toLowerCase()))
        .map((tag) => tag.id),
    });
  }

  async function deleteSelected() {
    const confirmed = await confirmDialog({
      title: t("conversation.deleteManyTitle", {
        count: selectedIds.size,
      }),
      description: t("conversation.deleteManyDescription"),
      destructive: true,
    });
    if (!confirmed) return;
    const deleted = await bulkConversationAction({
      action: "delete",
      conversationIds: selectedConversationIds,
    });
    if (deleted) {
      useToastStore.getState().addToast(t("toast.deleted"), "success");
      finishBulkMode();
    }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (collapsed) return;
    dragStart.current = {
      x: event.clientX,
      width: useSettingsStore.getState().sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const width = dragStart.current.width + event.clientX - dragStart.current.x;
    setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
  }

  return (
    <aside
      data-testid="sidebar"
      className="panel-glass-strong relative flex h-full flex-col overflow-hidden"
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-2 px-3 py-4">
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-primary)]"
            onClick={() => setSidebarCollapsed(false)}
            title={t("provider.show")}
            aria-label={t("provider.show")}
          >
            <PanelLeft size={18} />
          </button>
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-primary)]"
            onClick={() => void createConversation(defaultProvider)}
            title={t("nav.newChat")}
            aria-label={t("nav.newChat")}
          >
            <Plus size={18} />
          </button>
          <div className="mt-2 h-px w-8 bg-[var(--color-border)]" />
          {visibleProviders.map((provider) => (
            <button
              key={provider}
              className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              title={`${t("nav.newChat")} · ${PROVIDER_LABELS[provider]}`}
              onClick={() => void createConversation(provider)}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                {PROVIDER_LABELS[provider].slice(0, 2)}
              </span>
            </button>
          ))}
          <div className="mt-auto" />
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]"
            onClick={() =>
              setTheme(
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark",
              )
            }
            title={t("top.toggleTheme")}
            aria-label={t("top.toggleTheme")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]"
            onClick={() => openSettings()}
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
          >
            <Settings size={18} />
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pb-3 pt-4">
            <div className="mb-3 flex items-center gap-2">
              <button
                data-testid="new-conversation-chatgpt"
                className="interactive-chip flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 text-sm font-medium shadow-[var(--shadow-sm)] hover:bg-[var(--color-bg-hover)]"
                onClick={() => void createConversation(defaultProvider)}
              >
                <Plus size={16} />
                {t("nav.newChat")}
              </button>
              <button
                className="interactive-chip grid size-10 shrink-0 place-items-center rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]"
                onClick={() => setSidebarCollapsed(true)}
                aria-label={t("provider.hide")}
              >
                <PanelLeft size={16} />
              </button>
            </div>

            <SidebarSearch query={query} onChange={setQuery} />
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ProviderFilterTabs value={providerFilter} onChange={setProviderFilter} />
              </div>
              <button
                className="interactive-chip grid size-9 shrink-0 place-items-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft)] disabled:opacity-40"
                disabled={syncingHistory}
                onClick={() => void syncWebHistory()}
                title={t("provider.syncNow")}
                aria-label={t("provider.syncNow")}
              >
                <RefreshCw size={15} className={syncingHistory ? "animate-spin" : undefined} />
              </button>
            </div>
          </div>

          {selectionMode && (
            <div className="mx-4 mb-3 flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-2">
              <span className="mr-auto pl-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t("bulk.selected", { count: selectedIds.size })}
              </span>
              <BulkButton
                title={t("bulk.pin")}
                icon={Pin}
                disabled={!selectedIds.size}
                onClick={() =>
                  void bulkConversationAction({
                    action: "pin",
                    conversationIds: selectedConversationIds,
                    pinned: true,
                  })
                }
              />
              <BulkButton
                title={t("bulk.export")}
                icon={Download}
                disabled={!selectedIds.size}
                onClick={() => void exportSelected()}
              />
              <BulkButton
                title={t("bulk.folder")}
                icon={FolderInput}
                disabled={!selectedIds.size}
                onClick={() => void assignBulkFolder()}
              />
              <BulkButton
                title={t("bulk.tags")}
                icon={Tag}
                disabled={!selectedIds.size}
                onClick={() => void assignBulkTags()}
              />
              <BulkButton
                title={t("bulk.transfer")}
                icon={ArrowRightLeft}
                disabled={!selectedIds.size}
                onClick={() => setBulkTransferOpen(true)}
              />
              <BulkButton
                title={t("bulk.delete")}
                icon={Trash2}
                danger
                disabled={!selectedIds.size}
                onClick={() => void deleteSelected()}
              />
              <BulkButton
                title={t("bulk.close")}
                icon={X}
                onClick={finishBulkMode}
              />
            </div>
          )}

          <ConversationList
            conversations={conversations}
            searching={Boolean(query.trim())}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
          />

          <div className="shrink-0 border-t border-[var(--color-border-light)] px-3 py-2">
            <div className="flex items-center gap-1">
              {!selectionMode && (
                <button
                  className="interactive-chip grid size-8 place-items-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setSelectionMode(true)}
                  title={t("bulk.select")}
                  aria-label={t("bulk.select")}
                >
                  <CheckSquare size={14} />
                </button>
              )}
              <div className="flex-1" />
              <button
                className="interactive-chip grid size-8 place-items-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() =>
                  setTheme(
                    document.documentElement.dataset.theme === "dark"
                      ? "light"
                      : "dark",
                  )
                }
                title={t("top.toggleTheme")}
                aria-label={t("top.toggleTheme")}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <button
                className="interactive-chip grid size-8 place-items-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => openSettings()}
                title={t("nav.settings")}
                aria-label={t("nav.settings")}
              >
                <Settings size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-transparent transition hover:bg-[var(--color-bg-hover)]"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={() => {
          dragStart.current = undefined;
        }}
        onDoubleClick={() => setSidebarWidth(DEFAULT_WIDTH)}
      />
      <Dialog
        open={bulkTransferOpen}
        onClose={() => setBulkTransferOpen(false)}
        title={t("provider.transfer")}
        widthClass="w-[min(440px,calc(100vw-48px))]"
      >
        <select
          className="w-full rounded-lg border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] px-3 py-2"
          value={bulkTransferTarget}
          onChange={(event) =>
            setBulkTransferTarget(event.target.value as ProviderId)
          }
        >
          {visibleProviders.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)]"
            onClick={() => setBulkTransferOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--color-send-bg)] px-3 py-2 text-sm font-semibold text-[var(--color-send-text)]"
            onClick={() => {
              void bulkConversationAction({
                action: "migrate",
                conversationIds: selectedConversationIds,
                targetProvider: bulkTransferTarget,
              });
              setBulkTransferOpen(false);
            }}
          >
            {t("common.confirm")}
          </button>
        </div>
      </Dialog>
    </aside>
  );
}

function BulkButton({
  title,
  icon: Icon,
  disabled,
  danger,
  onClick,
}: {
  title: string;
  icon: typeof Pin;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`interactive-chip grid size-7 place-items-center rounded-lg ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      } disabled:cursor-not-allowed disabled:opacity-30`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={13} />
    </button>
  );
}

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100);
}
