import type { NormalizedMessage } from "@aihub/core";

export function messageText(message: NormalizedMessage): string {
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "code") {
        return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}
