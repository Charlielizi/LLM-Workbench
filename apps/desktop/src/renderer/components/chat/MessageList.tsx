import { useEffect, useRef } from "react";
import type { NormalizedConversation } from "@aihub/core";
import { MessageBubble } from "./MessageBubble";

export function MessageList({
  conversation,
}: {
  conversation: NormalizedConversation;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessage = conversation.messages.at(-1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [conversation.id, lastMessage?.content, lastMessage?.status]);

  return (
    <div ref={containerRef} className="min-h-0 overflow-y-auto px-6">
      <div className="mx-auto w-full max-w-[860px] py-3">
        {conversation.messages.length === 0 ? (
          <p className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">
            开始这段对话吧。
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
