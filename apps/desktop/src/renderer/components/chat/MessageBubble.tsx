import { useState } from "react";
import type { NormalizedMessage } from "@aihub/core";
import { PROVIDER_LABELS } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { messageText } from "../../utils/message-text";
import { MessageActions } from "./MessageActions";
import { MessageContent } from "./MessageContent";
import { MessageStatus } from "./MessageStatus";

export function MessageBubble({
  message,
  retrySource,
}: {
  message: NormalizedMessage;
  retrySource?: NormalizedMessage;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(() => messageText(message));
  const editAndResendMessage = useAppStore(
    (state) => state.editAndResendMessage,
  );
  const conversationBusy = useAppStore((state) =>
    state.busyConversations.has(message.conversationId),
  );
  const isUser = message.role === "user";

  async function submitEdit() {
    if (
      await editAndResendMessage(
        message.conversationId,
        message.id,
        editText,
      )
    ) {
      setEditing(false);
    }
  }

  async function retry() {
    const source = message.role === "user" ? message : retrySource;
    if (!source) return;
    await editAndResendMessage(
      source.conversationId,
      source.id,
      messageText(source),
    );
  }

  return (
    <article className={`group relative ${isUser ? "self-end" : "self-start"} w-full`}>
      <div className={isUser ? "ml-auto max-w-[78%]" : "max-w-full"}>
        {!isUser && (
          <header className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--color-text-tertiary)]">
            <span>{PROVIDER_LABELS[message.provider]}</span>
            <MessageStatus message={message} onRetry={retry} />
          </header>
        )}

        {editing ? (
          <div className="rounded-[1.75rem] border border-[var(--color-border-input)] bg-[var(--color-bg-elevated)] p-3 shadow-[var(--shadow-md)]">
            <textarea
              className="min-h-28 w-full resize-y rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-inset)] p-3 leading-6 outline-none transition focus:border-[var(--color-border-strong)]"
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="interactive-chip rounded-full px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => {
                  setEditText(messageText(message));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                className="interactive-chip rounded-full bg-[var(--color-send-bg)] px-3 py-1.5 text-sm font-medium text-[var(--color-send-text)] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={conversationBusy || !editText.trim()}
                onClick={() => void submitEdit()}
              >
                Save & resend
              </button>
            </div>
          </div>
        ) : isUser ? (
          <>
            <div className="rounded-[1.8rem] border border-[var(--color-user-bubble-border)] bg-[var(--color-user-bubble)] px-4 py-3 text-[var(--color-user-bubble-text)] shadow-[var(--shadow-sm)]">
              <MessageContent message={message} />
            </div>
            <div className="mt-1 flex justify-end pr-1 text-[11px] text-[var(--color-text-tertiary)]">
              <span>You</span>
              <span className="mx-1">·</span>
              <MessageStatus message={message} onRetry={retry} />
            </div>
          </>
        ) : (
          <div className="text-[var(--color-text-primary)]">
            <MessageContent message={message} />
          </div>
        )}
      </div>

      {!editing && (
        <MessageActions
          message={message}
          canRetry={message.role === "user" || Boolean(retrySource)}
          onEdit={() => setEditing(true)}
          onRetry={() => void retry()}
        />
      )}
    </article>
  );
}
