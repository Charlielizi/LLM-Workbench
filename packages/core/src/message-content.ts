import type { ContentBlock, NormalizedMessage } from "./types";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function imageToText(block: Extract<ContentBlock, { type: "image" }>): string {
  if (block.src) {
    return `![${block.alt ?? "image"}](${block.src})`;
  }
  return "[image]";
}

export function contentBlocksToText(content: ContentBlock[]): string {
  const parts: string[] = [];
  let htmlFallback = "";

  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "code") {
      parts.push(`\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``);
      continue;
    }
    if (block.type === "attachment") {
      parts.push(block.name);
      continue;
    }
    if (block.type === "citation") {
      parts.push(block.title ?? block.url);
      continue;
    }
    if (block.type === "image") {
      parts.push(imageToText(block));
      continue;
    }
    if (block.type === "math") {
      parts.push(block.tex);
      continue;
    }
    if (!htmlFallback && block.type === "html") {
      htmlFallback = htmlToText(block.html);
    }
  }

  return parts.join("\n\n").trim() || htmlFallback;
}

export function messageToText(message: NormalizedMessage): string {
  return contentBlocksToText(message.content);
}
