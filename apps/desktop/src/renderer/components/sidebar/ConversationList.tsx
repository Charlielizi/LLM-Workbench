import { LogIn, MessageSquare, Plus } from "lucide-react";
import {
  PROVIDER_LABELS,
  type NormalizedConversation,
  type ProviderId,
} from "@aihub/core";
import { groupConversationsByDate } from "../../utils/date-grouping";
import { useI18n } from "../../i18n";
import { ConversationItem } from "./ConversationItem";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";

export function ConversationList({
  conversations,
  searching,
  selectionMode,
  selectedIds,
  onToggleSelection,
  emptyProvider,
}: {
  conversations: NormalizedConversation[];
  searching: boolean;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  emptyProvider?: ProviderId;
}) {
  const { t } = useI18n();
  const createConversation = useAppStore(
    (state) => state.createConversation,
  );
  const providers = useAppStore((state) => state.snapshot.providers);
  const defaultProvider = useSettingsStore(
    (state) => state.defaultProvider ?? state.enabledProviders[0] ?? "chatgpt",
  );
  const actionProvider = emptyProvider ?? defaultProvider;
  const defaultState = providers.find(
    (provider) => provider.id === actionProvider,
  );
  const providerReady = Boolean(
    defaultState?.authenticated && defaultState.ready,
  );
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
          <div>
            {searching ? t("search.noMatches") : t("conversation.empty")}
          </div>
          {!searching && (
            <button
              type="button"
              className="interactive-chip mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-send-bg)] px-3 py-2 text-xs font-medium text-[var(--color-send-text)] shadow-[var(--shadow-sm)]"
              onClick={() => {
                if (providerReady) {
                  void createConversation(actionProvider);
                } else {
                  void window.aihub.setProviderWebsiteVisible(
                    actionProvider,
                    true,
                  );
                }
              }}
            >
              {providerReady ? <Plus size={14} /> : <LogIn size={14} />}
              {providerReady
                ? t("provider.action.startChatWith", {
                    provider: PROVIDER_LABELS[actionProvider],
                  })
                : t("provider.action.openLoginWith", {
                    provider: PROVIDER_LABELS[actionProvider],
                  })}
            </button>
          )}
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
