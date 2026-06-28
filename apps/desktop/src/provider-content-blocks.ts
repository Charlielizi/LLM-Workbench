import type { ContentBlock } from "@aihub/core";

function annotationTex(element: Element): string | undefined {
  const tex = element
    .querySelector("annotation[encoding*='tex']")
    ?.textContent
    ?.trim() ||
    element
      .querySelector("annotation")
      ?.textContent
      ?.trim();
  return tex || undefined;
}

function pushUnique(
  blocks: ContentBlock[],
  seen: Set<string>,
  key: string,
  block: ContentBlock,
): void {
  if (seen.has(key)) return;
  seen.add(key);
  blocks.push(block);
}

function mathBlockForElement(element: Element): Extract<ContentBlock, { type: "math" }> | undefined {
  if (
    element.tagName === "MJX-CONTAINER" &&
    !element.parentElement?.closest("mjx-container")
  ) {
    const tex = annotationTex(element);
    if (!tex) return undefined;
    return {
      type: "math",
      tex,
      display: element.getAttribute("display") === "true",
      source: "mathjax",
    };
  }

  if (
    element.classList.contains("katex") &&
    !element.parentElement?.closest(".katex")
  ) {
    const tex = annotationTex(element);
    if (!tex) return undefined;
    return {
      type: "math",
      tex,
      display: Boolean(element.closest(".katex-display")),
      source: "katex",
    };
  }

  if (
    element.tagName === "MATH" &&
    !element.parentElement?.closest(".katex,mjx-container,math")
  ) {
    const tex = annotationTex(element) || element.textContent?.trim();
    if (!tex) return undefined;
    return {
      type: "math",
      tex,
      display: element.getAttribute("display") === "block",
      source: "mathml",
    };
  }

  return undefined;
}

export function buildAssistantContentBlocks(
  root: HTMLElement | undefined,
  text: string,
  html?: string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();

  if (text.trim()) {
    blocks.push({ type: "text", text });
  }

  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();
    while (current) {
      const element = current as Element;
      if (element instanceof HTMLImageElement) {
        const src = element.getAttribute("src")?.trim();
        if (src) {
          pushUnique(blocks, seen, `image:${src}`, {
            type: "image",
            src,
            alt: element.getAttribute("alt")?.trim() || undefined,
            title: element.getAttribute("title")?.trim() || undefined,
          });
        }
      }

      const math = mathBlockForElement(element);
      if (math) {
        pushUnique(
          blocks,
          seen,
          `math:${math.source}:${math.display ? "1" : "0"}:${math.tex}`,
          math,
        );
      }

      current = walker.nextNode();
    }
  }

  if (html?.trim()) {
    blocks.push({
      type: "html",
      kind: "provider-assistant",
      html,
    });
  }

  return blocks;
}
