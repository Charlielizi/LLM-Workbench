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
  Settings,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@aihub/core";
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

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;

export function Sidebar() {
  const [providerFilter, setProviderFilter] =
    useState<ProviderFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const setSettingsModalOpen = useAppStore(
    (state) => state.setSettingsModalOpen,
  );
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
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
    <aside className="panel-glass-strong relative flex h-full flex-col overflow-hidden">
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-2 px-3 py-4">
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-primary)]"
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar"
          >
            <PanelLeft size={18} />
          </button>
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-primary)]"
            onClick={() => void createConversation("chatgpt")}
            title="New conversation"
          >
            <Plus size={18} />
          </button>
          <div className="mt-2 h-px w-8 bg-[var(--color-border)]" />
          {PROVIDER_IDS.map((provider) => (
            <button
              key={provider}
              className="interactive-chip grid size-11 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              title={`New ${PROVIDER_LABELS[provider]} conversation`}
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
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="interactive-chip grid size-11 place-items-center rounded-2xl text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]"
            onClick={() => setSettingsModalOpen(true)}
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pb-3 pt-4">
            <div className="mb-3 flex items-center gap-2">
              <button
                className="interactive-chip flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 text-sm font-medium shadow-[var(--shadow-sm)] hover:bg-[var(--color-bg-hover)]"
                onClick={() => void createConversation("chatgpt")}
              >
                <Plus size={16} />
                New chat
              </button>
              <button
                className="interactive-chip grid size-10 shrink-0 place-items-center rounded-2xl text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft)] hover:text-[var(--color-text-primary)]"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
              >
                <PanelLeft size={16} />
              </button>
            </div>

            <SidebarSearch query={query} onChange={setQuery} />
            <ProviderFilterTabs
              value={providerFilter}
              onChange={setProviderFilter}
            />
          </div>

          {selectionMode && (
            <div className="mx-4 mb-3 flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-2">
              <span className="mr-auto pl-1 text-[11px] text-[var(--color-text-tertiary)]">
                {selectedIds.size} selected
              </span>
              <BulkButton
                title="Pin"
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
                title="Export"
                icon={Download}
                disabled={!selectedIds.size}
                onClick={() => void exportSelected()}
              />
              <BulkButton
                title="Folder"
                icon={FolderInput}
                disabled={!selectedIds.size}
                onClick={() => {
                  const name = window.prompt(
                    `Folder: ${folders.map((f) => f.name).join(", ")}`,
                  );
                  const folder = folders.find(
                    (f) => f.name.toLowerCase() === name?.trim().toLowerCase(),
                  );
                  void bulkConversationAction({
                    action: "set-folder",
                    conversationIds: selectedConversationIds,
                    folderId: folder?.id ?? null,
                  });
                }}
              />
              <BulkButton
                title="Tags"
                icon={Tag}
                disabled={!selectedIds.size}
                onClick={() => {
                  const names =
                    window
                      .prompt(
                        `Tags: ${tags.map((t) => t.name).join(", ")}`,
                      )
                      ?.split(/[,，]/)
                      .map((n) => n.trim().toLowerCase()) ?? [];
                  void bulkConversationAction({
                    action: "set-tags",
                    conversationIds: selectedConversationIds,
                    tagIds: tags
                      .filter((t) => names.includes(t.name.toLowerCase()))
                      .map((t) => t.id),
                  });
                }}
              />
              <BulkButton
                title="Transfer"
                icon={ArrowRightLeft}
                disabled={!selectedIds.size}
                onClick={() => {
                  const target = window.prompt(
                    `Target provider: ${PROVIDER_IDS.join(", ")}`,
                  ) as ProviderId | null;
                  if (target && PROVIDER_IDS.includes(target)) {
                    void bulkConversationAction({
                      action: "migrate",
                      conversationIds: selectedConversationIds,
                      targetProvider: target,
                    });
                  }
                }}
              />
              <BulkButton
                title="Delete"
                icon={Trash2}
                danger
                disabled={!selectedIds.size}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selectedIds.size} conversations?`,
                    )
                  ) {
                    void bulkConversationAction({
                      action: "delete",
                      conversationIds: selectedConversationIds,
                    }).then(finishBulkMode);
                  }
                }}
              />
              <BulkButton title="Close" icon={X} onClick={finishBulkMode} />
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
                  title="Bulk select"
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
                title="Toggle theme"
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <button
                className="interactive-chip grid size-8 place-items-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => setSettingsModalOpen(true)}
                title="Settings"
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
