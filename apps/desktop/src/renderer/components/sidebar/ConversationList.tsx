import { MessageSquare } from "lucide-react";
import type { NormalizedConversation } from "@aihub/core";
import { groupConversationsByDate } from "../../utils/date-grouping";
import { ConversationItem } from "./ConversationItem";

export function ConversationList({
  conversations,
  searching,
  selectionMode,
  selectedIds,
  onToggleSelection,
}: {
  conversations: NormalizedConversation[];
  searching: boolean;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
}) {
  const pinned = conversations.filter((conversation) => conversation.pinned);
  const groups = groupConversationsByDate(
    conversations.filter((conversation) => !conversation.pinned),
  );

  if (conversations.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center text-sm leading-6 text-[var(--color-text-tertiary)]">
        <div>
          <MessageSquare className="mx-auto mb-3" size={24} />
          {searching ? "没有找到匹配的会话。" : "登录一个模型，然后创建新对话。"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {pinned.length > 0 && (
        <section className="mb-3">
          <h2 className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            置顶
          </h2>
          {pinned.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selectionMode={selectionMode}
              selected={selectedIds?.has(conversation.id)}
              onToggleSelection={onToggleSelection}
            />
          ))}
        </section>
      )}
      {groups.map((group) => (
        <section key={group.label} className="mb-3">
          <h2 className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            {group.label}
          </h2>
          {group.conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selectionMode={selectionMode}
              selected={selectedIds?.has(conversation.id)}
              onToggleSelection={onToggleSelection}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
