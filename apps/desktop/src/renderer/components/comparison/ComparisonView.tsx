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
          className="rounded-full border border-[var(--color-border)] px-4 py-2"
          onClick={() => setActiveComparison(undefined)}
        >
          Back to chat
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
      <header className="panel-glass sticky top-0 z-10 px-5 pb-3 pt-4">
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-3 shadow-[var(--shadow-sm)]">
          <button
            className="interactive-chip rounded-full p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={() => setActiveComparison(undefined)}
            aria-label="Back to chat"
          >
            <ArrowLeft size={17} />
          </button>
          <h1 className="truncate font-medium">{session.title}</h1>
        </div>
      </header>
      <div
        className="grid min-h-0 gap-px overflow-hidden bg-[var(--color-border-light)] px-5"
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
              className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-t-[1.5rem] bg-[var(--color-bg-primary)]"
            >
              <header className="panel-glass px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)]">
                {PROVIDER_LABELS[participant.provider]}
              </header>
              <div className="min-h-0 overflow-y-auto px-4 py-4">
                <div className="flex flex-col gap-5">
                  {conversation?.messages.map((message) => (
                    <article key={message.id}>
                      <div className="mb-2 text-[11px] text-[var(--color-text-tertiary)]">
                        {message.role === "user"
                          ? "You"
                          : PROVIDER_LABELS[message.provider]}
                      </div>
                      <div
                        className={
                          message.role === "user"
                            ? "ml-auto max-w-[85%] rounded-[1.6rem] border border-[var(--color-user-bubble-border)] bg-[var(--color-user-bubble)] px-4 py-3 text-[var(--color-user-bubble-text)]"
                            : ""
                        }
                      >
                        <MessageContent message={message} />
                      </div>
                      <div className="mt-2">
                        <MessageStatus
                          message={message}
                          onRetry={async () => undefined}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="px-5 pb-5 pt-4">
        <div className="panel-glass-strong mx-auto flex max-w-5xl items-end gap-2 rounded-[1.8rem] border border-[var(--color-border-input)] p-3 shadow-[var(--shadow-md)]">
          <textarea
            className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-1 outline-none"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Send the same prompt to every provider"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="interactive-chip grid size-11 place-items-center rounded-full bg-[var(--color-send-bg)] text-[var(--color-send-text)] disabled:opacity-40"
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
