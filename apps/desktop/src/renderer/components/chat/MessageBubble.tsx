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
  const busy = useAppStore((state) => state.busy);

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
    <article
      className={`group relative mb-5 rounded-2xl border border-[var(--color-border-light)] px-5 py-4 ${
        message.role === "user"
          ? "ml-[8%] bg-[var(--color-bg-active)]"
          : "mr-[3%] bg-[var(--color-bg-tertiary)]"
      }`}
    >
      <header className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <span>
          {message.role === "user"
            ? "你"
            : PROVIDER_LABELS[message.provider]}
        </span>
        <MessageStatus status={message.status} onRetry={retry} />
      </header>

      {editing ? (
        <div>
          <textarea
            className="min-h-28 w-full resize-y rounded-xl border border-[var(--color-border-input)] bg-[var(--color-bg-inset)] p-3 leading-6 outline-none focus:border-[var(--color-accent)]"
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            autoFocus
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-sm hover:bg-[var(--color-bg-hover)]"
              onClick={() => {
                setEditText(messageText(message));
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              className="rounded-lg bg-[var(--color-accent-bg)] px-3 py-1.5 text-sm font-semibold text-[#08100c] disabled:opacity-40"
              disabled={busy || !editText.trim()}
              onClick={() => void submitEdit()}
            >
              保存并重发
            </button>
          </div>
        </div>
      ) : (
        <MessageContent message={message} />
      )}

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
