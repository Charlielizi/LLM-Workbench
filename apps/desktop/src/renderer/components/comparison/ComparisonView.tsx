import { useState } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { PROVIDER_LABELS } from "@aihub/core";
import { useAppStore } from "../../stores/app-store";
import { MessageContent } from "../chat/MessageContent";
import { MessageStatus } from "../chat/MessageStatus";

export function ComparisonView() {
  const [text, setText] = useState("");
  const activeId = useAppStore((state) => state.activeComparisonId);
  const snapshot = useAppStore((state) => state.snapshot);
  const setActiveComparison = useAppStore(
    (state) => state.setActiveComparison,
  );
  const sendComparison = useAppStore((state) => state.sendComparison);
  const busy = useAppStore((state) => state.busy);
  const session = snapshot.comparisons.find(
    (comparison) => comparison.id === activeId,
  );

  if (!session) {
    return (
      <main className="grid h-full place-items-center">
        <button
          className="rounded-lg border border-[var(--color-border)] px-4 py-2"
          onClick={() => setActiveComparison(undefined)}
        >
          返回聊天
        </button>
      </main>
    );
  }
  const sessionId = session.id;

  async function send() {
    if (await sendComparison(sessionId, text)) setText("");
  }

  return (
    <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <button
          className="rounded-lg p-2 hover:bg-[var(--color-bg-hover)]"
          onClick={() => setActiveComparison(undefined)}
          aria-label="返回聊天"
        >
          <ArrowLeft size={17} />
        </button>
        <h1 className="truncate font-semibold">{session.title}</h1>
      </header>
      <div
        className="grid min-h-0 divide-x divide-[var(--color-border)] overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${session.participants.length}, minmax(280px, 1fr))`,
        }}
      >
        {session.participants.map((participant) => {
          const conversation = snapshot.conversations.find(
            (item) => item.id === participant.conversationId,
          );
          return (
            <section
              key={participant.conversationId}
              className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]"
            >
              <header className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">
                {PROVIDER_LABELS[participant.provider]}
              </header>
              <div className="min-h-0 overflow-y-auto p-4">
                {conversation?.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`mb-3 rounded-xl border border-[var(--color-border-light)] p-3 ${
                      message.role === "user"
                        ? "bg-[var(--color-bg-active)]"
                        : "bg-[var(--color-bg-tertiary)]"
                    }`}
                  >
                    <header className="mb-2 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                      {message.role === "user"
                        ? "你"
                        : PROVIDER_LABELS[message.provider]}
                      <MessageStatus
                        status={message.status}
                        onRetry={async () => undefined}
                      />
                    </header>
                    <MessageContent message={message} />
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border border-[var(--color-border-input)] bg-[var(--color-bg-elevated)] p-2">
          <textarea
            className="max-h-40 min-h-12 flex-1 resize-none bg-transparent p-2 outline-none"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="向所有参与 Provider 发送同一条消息…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="grid size-10 place-items-center rounded-lg bg-[var(--color-accent-bg)] text-[#08100c] disabled:opacity-40"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </main>
  );
}
