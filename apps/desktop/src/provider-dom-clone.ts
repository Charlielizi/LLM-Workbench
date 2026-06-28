function cloneDomNode(node: Node): Node {
  if (node instanceof HTMLElement) {
    const clone = node.cloneNode(false) as HTMLElement;
    for (const child of Array.from(node.childNodes)) {
      clone.appendChild(cloneDomNode(child));
    }
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.childNodes)) {
        clone.appendChild(cloneDomNode(child));
      }
    }
    return clone;
  }
  return node.cloneNode(true);
}

export function cloneElementWithShadow<T extends HTMLElement>(element: T): T {
  return cloneDomNode(element) as T;
}
