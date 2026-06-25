import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  ArrowRightLeft,
  CheckSquare,
  Download,
  FolderInput,
  PanelLeft,
  Pin,
  Plus,
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

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 270;

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
    <aside className="relative min-h-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {collapsed ? (
        <div className="flex h-full flex-col items-center gap-3 py-4">
          {PROVIDER_IDS.map((provider) => (
            <button
              key={provider}
              className="grid size-10 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)]"
              title={`新建 ${PROVIDER_LABELS[provider]} 会话`}
              onClick={() => void createConversation(provider)}
            >
              <Plus size={17} />
            </button>
          ))}
          <PanelLeft
            size={18}
            className="mt-auto text-[var(--color-text-tertiary)]"
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid grid-cols-2 gap-2 p-3">
            {PROVIDER_IDS.map((provider) => (
              <button
                key={provider}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-2 text-xs hover:bg-[var(--color-bg-hover)]"
                onClick={() => void createConversation(provider)}
              >
                <Plus size={14} />
                <span className="truncate">{PROVIDER_LABELS[provider]}</span>
              </button>
            ))}
          </div>
          <SidebarSearch query={query} onChange={setQuery} />
          <ProviderFilterTabs
            value={providerFilter}
            onChange={setProviderFilter}
          />
          {folders.length > 0 && (
            <label className="mx-3 mb-2 block">
              <select
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]"
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
              >
                <option value="all">全部文件夹</option>
                <option value="none">未归档</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mx-3 mb-2 flex items-center gap-1">
            {selectionMode ? (
              <>
                <span className="mr-auto text-[11px] text-[var(--color-text-tertiary)]">
                  已选 {selectedIds.size} 项
                </span>
                <BulkButton
                  title="置顶"
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
                  title="导出"
                  icon={Download}
                  disabled={!selectedIds.size}
                  onClick={() => void exportSelected()}
                />
                <BulkButton
                  title="移动"
                  icon={FolderInput}
                  disabled={!selectedIds.size}
                  onClick={() => {
                    const name = window.prompt(
                      `文件夹：${folders.map((folder) => folder.name).join("、")}`,
                    );
                    const folder = folders.find(
                      (item) =>
                        item.name.toLowerCase() === name?.trim().toLowerCase(),
                    );
                    void bulkConversationAction({
                      action: "set-folder",
                      conversationIds: selectedConversationIds,
                      folderId: folder?.id ?? null,
                    });
                  }}
                />
                <BulkButton
                  title="标签"
                  icon={Tag}
                  disabled={!selectedIds.size}
                  onClick={() => {
                    const names =
                      window
                        .prompt(
                          `标签：${tags.map((tag) => tag.name).join("、")}`,
                        )
                        ?.split(/[,，]/)
                        .map((name) => name.trim().toLowerCase()) ?? [];
                    void bulkConversationAction({
                      action: "set-tags",
                      conversationIds: selectedConversationIds,
                      tagIds: tags
                        .filter((tag) =>
                          names.includes(tag.name.toLowerCase()),
                        )
                        .map((tag) => tag.id),
                    });
                  }}
                />
                <BulkButton
                  title="迁移"
                  icon={ArrowRightLeft}
                  disabled={!selectedIds.size}
                  onClick={() => {
                    const target = window.prompt(
                      `目标 Provider ID：${PROVIDER_IDS.join("、")}`,
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
                  title="删除"
                  icon={Trash2}
                  danger
                  disabled={!selectedIds.size}
                  onClick={() => {
                    if (window.confirm(`删除 ${selectedIds.size} 个会话？`)) {
                      void bulkConversationAction({
                        action: "delete",
                        conversationIds: selectedConversationIds,
                      }).then(finishBulkMode);
                    }
                  }}
                />
                <BulkButton title="退出" icon={X} onClick={finishBulkMode} />
              </>
            ) : (
              <button
                className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)]"
                onClick={() => setSelectionMode(true)}
              >
                <CheckSquare size={13} />
                批量
              </button>
            )}
          </div>
          <ConversationList
            conversations={conversations}
            searching={Boolean(query.trim())}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
          />
        </div>
      )}
      <div
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]"
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
      className={`grid size-7 place-items-center rounded-md ${
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
          : "hover:bg-[var(--color-bg-hover)]"
      } disabled:opacity-30`}
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
