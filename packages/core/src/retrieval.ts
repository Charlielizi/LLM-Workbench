export interface RetrievalChunk {
  documentId: string;
  documentName: string;
  text: string;
  score: number;
}

export function retrieveRelevantChunks(
  query: string,
  documents: { id: string; name: string; content: string }[],
  limit = 5,
): RetrievalChunk[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const chunks = documents.flatMap((document) =>
    splitIntoChunks(document.content).map((text) => ({
      documentId: document.id,
      documentName: document.name,
      text,
    })),
  );
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(
      term,
      chunks.filter((chunk) => tokenize(chunk.text).includes(term)).length,
    );
  }
  return chunks
    .map((chunk) => {
      const chunkTerms = tokenize(chunk.text);
      const score = terms.reduce((total, term) => {
        const frequency = chunkTerms.filter((item) => item === term).length;
        if (!frequency) return total;
        return (
          total +
          frequency *
            (1 +
              Math.log(
                (chunks.length + 1) /
                  ((documentFrequency.get(term) ?? 0) + 1),
              ))
        );
      }, 0);
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function buildKnowledgeContext(
  query: string,
  documents: { id: string; name: string; content: string }[],
  limit = 5,
): string {
  const chunks = retrieveRelevantChunks(query, documents, limit);
  if (!chunks.length) return query;
  const context = chunks
    .map(
      (chunk, index) =>
        `[资料 ${index + 1}：${chunk.documentName}]\n${chunk.text}`,
    )
    .join("\n\n");
  return `[本地参考资料 - 请仅在相关时使用，并优先回答用户问题]
${context}
[本地参考资料结束]

${query}`;
}

function splitIntoChunks(content: string, maxLength = 1_200): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxLength) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > maxLength) {
      for (let index = 0; index < paragraph.length; index += maxLength) {
        chunks.push(paragraph.slice(index, index + maxLength));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? [];
  const cjkPairs = cjk.slice(0, -1).map((character, index) => {
    return `${character}${cjk[index + 1]}`;
  });
  return [...words, ...cjk, ...cjkPairs];
}
