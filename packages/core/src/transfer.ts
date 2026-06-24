import type { NormalizedConversation, NormalizedMessage } from "./types";

const REQUIRED_HEADINGS = [
  "# Conversation Transfer",
  "## User Requirements",
  "## Confirmed Facts",
  "## Decisions",
  "## Current Task",
  "## Unresolved Questions",
  "## Recent Verbatim Turns",
  "## Earlier Conversation Summary",
] as const;

function messageText(message: NormalizedMessage): string {
  return message.content
    .filter((block) => block.type === "text" || block.type === "code")
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n")
    .trim();
}

export function buildTransferDraft(
  conversation: NormalizedConversation,
): string {
  const recent = conversation.messages.slice(-5);
  const earlier = conversation.messages.slice(0, -5);
  const userRequirements = conversation.messages
    .filter((message) => message.role === "user")
    .slice(0, 3)
    .map((message) => `- ${messageText(message)}`)
    .join("\n");

  const recentTurns = recent
    .map(
      (message) =>
        `### ${message.role === "user" ? "User" : "Assistant"}\n${messageText(message)}`,
    )
    .join("\n\n");

  return `# Conversation Transfer

## User Requirements
${userRequirements || "- Review the recent verbatim turns and preserve the user's intent."}

## Confirmed Facts
- Extract only facts explicitly established in the conversation.

## Decisions
- Preserve decisions and their stated rationale.

## Current Task
- Continue the task represented by the most recent user message.

## Unresolved Questions
- Keep unresolved questions explicit; do not invent answers.

## Recent Verbatim Turns
${recentTurns || "- No recent turns."}

## Earlier Conversation Summary
- ${earlier.length} earlier messages must be summarized faithfully by the target model.
`;
}

export function buildCompressionPrompt(draft: string): string {
  return `You are preparing context for a new conversation. Do not answer the user's task.
Rewrite the material below as concise Markdown using exactly the same eight headings.
Keep the Recent Verbatim Turns unchanged. Do not invent facts, decisions, or requirements.
Return only Markdown.

${draft}`;
}

export function validateTransferMarkdown(markdown: string): boolean {
  return (
    markdown.length >= 200 &&
    markdown.length <= 120_000 &&
    REQUIRED_HEADINGS.every((heading) => markdown.includes(heading))
  );
}

export { REQUIRED_HEADINGS };
