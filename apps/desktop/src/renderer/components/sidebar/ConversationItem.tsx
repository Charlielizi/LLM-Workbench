import { useState } from "react";
import type { MouseEvent } from "react";
import { Pin } from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import type { NormalizedConversation } from "@aihub/core";
import { blockText, useAppStore, useSelectedConversation } from "../../stores/app-store";
import { ConversationContextMenu } from "./ConversationContextMenu";

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
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const selected = useSelectedConversation();
  const selectConversation = useAppStore(
    (state) => state.selectConversation,
  );
  const streaming = useAppStore((state) =>
    state.streamingConversations.has(conversation.id),
  );
  const allTags = useAppStore((state) => state.tags);
  const tags = allTags.filter((tag) => conversation.tagIds.includes(tag.id));

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    selectConversation(conversation.id);
    setMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <button
        className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${
          conversation.id === selected?.id
            ? "bg-[var(--color-bg-active)]"
            : "hover:bg-[var(--color-bg-hover)]"
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
              className={`grid size-4 shrink-0 place-items-center rounded border ${
                selectedInBulk
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[#08100c]"
                  : "border-[var(--color-border-strong)]"
              }`}
            >
              {selectedInBulk ? "✓" : ""}
            </span>
          )}
          {conversation.pinned && (
            <Pin
              size={12}
              fill="currentColor"
              className="shrink-0 text-[var(--color-accent)]"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {conversation.title}
          </span>
          {streaming && (
            <i className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
          <span>{PROVIDER_LABELS[conversation.provider]}</span>
          <span className="truncate">{blockText(conversation)}</span>
        </div>
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-1.5 py-0.5 text-[9px]"
                style={{ color: tag.color, background: `${tag.color}20` }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
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
