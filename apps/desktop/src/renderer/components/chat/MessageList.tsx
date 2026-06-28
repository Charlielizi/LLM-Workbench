import { useEffect, useRef } from "react";
import type { NormalizedConversation } from "@aihub/core";
import { MessageBubble } from "./MessageBubble";

const AUTO_SCROLL_THRESHOLD_PX = 80;

export function MessageList({
  conversation,
}: {
  conversation: NormalizedConversation;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousConversationIdRef = useRef(conversation.id);
  const lastMessage = conversation.messages.at(-1);

  function updateAutoScrollState() {
    const container = containerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const conversationChanged = previousConversationIdRef.current !== conversation.id;
    previousConversationIdRef.current = conversation.id;
    if (conversationChanged) {
      shouldAutoScrollRef.current = true;
    }
    if (!shouldAutoScrollRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [conversation.id, lastMessage?.content, lastMessage?.status]);

  return (
    <div
      ref={containerRef}
      className="min-h-0 overflow-y-auto px-6"
      onScroll={updateAutoScrollState}
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-7 pb-8 pt-4">
        {conversation.messages.length === 0 ? (
          <p className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">
            Start the conversation.
          </p>
        ) : (
          conversation.messages.map((message, index) => {
            const previous = conversation.messages[index - 1];
            const retrySource =
              message.role === "assistant" && previous?.role === "user"
                ? previous
                : undefined;
            return (
              <MessageBubble
                key={message.id}
                message={message}
                retrySource={retrySource}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
