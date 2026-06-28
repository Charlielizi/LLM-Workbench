import type { ContentBlock, NormalizedConversation, NormalizedMessage } from "@aihub/core";

function blockSignature(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return `text:${block.text}`;
    case "code":
      return `code:${block.language ?? ""}:${block.text}`;
    case "attachment":
      return `attachment:${block.name}:${block.localPath ?? ""}`;
    case "citation":
      return `citation:${block.title ?? ""}:${block.url}`;
    case "image":
      return `image:${block.src}:${block.alt ?? ""}:${block.title ?? ""}`;
    case "math":
      return `math:${block.source}:${block.display ? "1" : "0"}:${block.tex}`;
    case "html":
      return `html:${block.kind}:${block.html}`;
  }
}

function messageSignature(message: NormalizedMessage | undefined): string {
  if (!message) return "";
  return [
    message.id,
    message.status,
    message.statusPhase ?? "",
    message.statusDetail ?? "",
    message.errorCode ?? "",
    message.providerHtml ?? "",
    message.content.map(blockSignature).join("\u241e"),
  ].join("\u241f");
}

export function conversationSnapshotSignature(
  conversation: NormalizedConversation,
): string {
  return [
    conversation.id,
    conversation.title,
    String(conversation.hidden),
    String(conversation.pinned),
    conversation.pinnedAt ?? "",
    conversation.externalId ?? "",
    conversation.updatedAt,
    String(conversation.messages.length),
    messageSignature(conversation.messages.at(-1)),
  ].join("\u241d");
}
