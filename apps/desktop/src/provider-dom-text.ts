const IGNORED_TEXT_CONTAINERS =
  "#input-engine-container," +
  "footer,nav,aside," +
  "[role='dialog']," +
  "[class*='message-action']," +
  "[class*='suggest-message']," +
  "[class*='suggest-list']," +
  "[class*='bottom-placeholder']," +
  "[class*='to-bottom-button']," +
  "[class*='carousel']," +
  "[data-visible='false']";

function isLikelyDropzoneOverlay(element: Element): boolean {
  const className = String((element as HTMLElement).className ?? "");
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return false;
  if (!/拖放文件|drag\s*files?|drop\s*files?|upload file/i.test(text)) {
    return false;
  }
  return /absolute|overlay|upload|drag|drop/i.test(className);
}

function shouldIgnoreElement(element: Element): boolean {
  return element.matches(IGNORED_TEXT_CONTAINERS) || isLikelyDropzoneOverlay(element);
}

export function childNodesWithShadow(node: ParentNode): Node[] {
  const nodes: Node[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child instanceof Element && shouldIgnoreElement(child)) {
      continue;
    }
    nodes.push(child);
    if (child instanceof Element) {
      nodes.push(...childNodesWithShadow(child));
    }
    if (child instanceof Element && child.shadowRoot) {
      nodes.push(...childNodesWithShadow(child.shadowRoot));
    }
  }
  return nodes;
}

export function plainTextWithShadow(root: ParentNode): string {
  const chunks: string[] = [];
  for (const node of childNodesWithShadow(root)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.replace(/\s+/g, " ").trim();
      if (value) chunks.push(value);
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    if (node.matches("script,style,noscript")) continue;
    if (node.tagName === "BR") chunks.push("\n");
    if (/^(P|DIV|LI|PRE|H[1-6]|TR|SECTION|ARTICLE)$/.test(node.tagName)) {
      chunks.push("\n");
    }
  }
  return chunks
    .join(" ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
