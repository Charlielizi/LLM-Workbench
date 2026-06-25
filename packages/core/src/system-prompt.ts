export function wrapWithSystemPrompt(
  userMessage: string,
  systemPrompt: string,
): string {
  const instruction = systemPrompt.trim();
  if (!instruction) return userMessage;
  return `[系统指令 - 请在整个对话中遵循以下指导]
${instruction}
[系统指令结束]

${userMessage}`;
}
