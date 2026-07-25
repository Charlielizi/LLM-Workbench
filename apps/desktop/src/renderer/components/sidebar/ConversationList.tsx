import { MessageSquare } from "lucide-react";
import type { NormalizedConversation } from "@aihub/core";
import { groupConversationsByDate } from "../../utils/date-grouping";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  const pinned = conversations.filter((conversation) => conversation.pinned);
  const groups = groupConversationsByDate(
    conversations.filter((conversation) => !conversation.pinned),
    (group) =>
      t(
        group === "today"
          ? "date.today"
          : group === "yesterday"
            ? "date.yesterday"
            : group === "this_week"
              ? "date.thisWeek"
              : group === "this_month"
                ? "date.thisMonth"
                : "date.older",
      ),
  );

  if (conversations.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center text-sm leading-6 text-[var(--color-text-tertiary)]">
        <div className="max-w-52">
          <MessageSquare className="mx-auto mb-3" size={24} />
          {searching ? t("search.noMatches") : t("conversation.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-14">
      {pinned.length > 0 && (
        <section className="mb-3">
          <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
            {t("conversation.pinnedGroup")}
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
          <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
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
