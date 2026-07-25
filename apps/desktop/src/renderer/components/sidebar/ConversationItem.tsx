import { useState } from "react";
import type { MouseEvent } from "react";
import { MoreHorizontal, Pin } from "lucide-react";
import type { NormalizedConversation } from "@aihub/core";
import {
  useAppStore,
  useSelectedConversation,
} from "../../stores/app-store";
import { ConversationContextMenu } from "./ConversationContextMenu";
import { useI18n } from "../../i18n";

export function ConversationItem({
  conversation,
  selectionMode,
  selected: selectedInBulk,
  onToggleSelection,
}: {
  conversation: NormalizedConversation;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const selected = useSelectedConversation();
  const selectConversation = useAppStore(
    (state) => state.selectConversation,
  );
  const streaming = useAppStore((state) =>
    state.streamingConversations.has(conversation.id),
  );
  const active = conversation.id === selected?.id;

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    selectConversation(conversation.id);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <button
        data-testid={`conversation-item-${conversation.id}`}
        data-provider={conversation.provider}
        aria-current={active ? "page" : undefined}
        className={`group mb-0.5 w-full rounded-xl px-3 py-1.5 text-left transition ${
          active
            ? "bg-[var(--color-bg-elevated)] shadow-[var(--shadow-sm)]"
            : "hover:bg-[var(--color-bg-soft)]"
        }`}
        onClick={() => {
          if (selectionMode) onToggleSelection?.(conversation.id);
          else selectConversation(conversation.id);
        }}
        onContextMenu={openMenu}
      >
        <div className="flex items-center gap-2">
          {selectionMode && (
            <span
              className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] ${
                selectedInBulk
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-send-text)]"
                  : "border-[var(--color-border-strong)]"
              }`}
            >
              {selectedInBulk ? "✓" : ""}
            </span>
          )}
          {conversation.pinned && (
            <Pin
              size={11}
              fill="currentColor"
              className="shrink-0 text-[var(--color-text-tertiary)]"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] leading-6">
            {conversation.title}
          </span>
          {conversation.syncStatus &&
            conversation.syncStatus !== "synced" &&
            conversation.syncStatus !== "not-synced" && (
              <i
                title={
                  conversation.syncError ??
                  t("conversation.syncStatus", {
                    status:
                      conversation.syncStatus === "syncing"
                        ? t("conversation.sync.syncing")
                        : conversation.syncStatus === "partial"
                          ? t("conversation.sync.partial")
                          : conversation.syncStatus === "remote-missing"
                            ? t("conversation.sync.remoteMissing")
                            : t("conversation.sync.error"),
                  })
                }
                className={`size-1.5 shrink-0 rounded-full ${
                  conversation.syncStatus === "syncing"
                    ? "animate-pulse bg-blue-400"
                    : conversation.syncStatus === "remote-missing"
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
              />
            )}
          {streaming && (
            <i className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-text-primary)]" />
          )}
          {!selectionMode && (
            <span className="rounded p-0.5 text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100">
              <MoreHorizontal size={13} />
            </span>
          )}
        </div>
      </button>
      {menu && (
        <ConversationContextMenu
          conversation={conversation}
          position={menu}
          onClose={() => setMenu(undefined)}
        />
      )}
    </>
  );
}
