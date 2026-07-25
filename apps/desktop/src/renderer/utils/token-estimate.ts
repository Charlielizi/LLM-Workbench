const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkChars = (text.match(CJK_RE) ?? []).length;
  const asciiChars = text.length - cjkChars;
  return Math.max(
    1,
    Math.ceil(asciiChars / 4) + Math.ceil(cjkChars / 2),
  );
}
