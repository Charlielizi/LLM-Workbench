import katex from "katex";

const DANGEROUS_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "FRAME",
  "FRAMESET",
  "OBJECT",
  "EMBED",
  "APPLET",
  "META",
  "LINK",
  "BASE",
  "FORM",
]);

function safeUrl(
  value: string,
  kind: "navigation" | "resource",
): string {
  try {
    const url = new URL(value, "about:blank");
    const allowedProtocols = kind === "navigation"
      ? ["http:", "https:"]
      : ["http:", "https:", "data:"];
    return allowedProtocols.includes(url.protocol) ? value : "";
  } catch {
    return "";
  }
}

function mathPlaceholder(tex: string, display: boolean): HTMLElement {
  const element = document.createElement(display ? "div" : "span");
  element.className = "aihub-math";
  element.dataset.tex = tex;
  element.dataset.display = display ? "true" : "false";
  return element;
}

function replaceFormulaContainers(root: ParentNode): void {
  for (const container of Array.from(root.querySelectorAll("mjx-container"))) {
    const annotation = container.querySelector("annotation[encoding*='tex']");
    const tex = annotation?.textContent?.trim();
    if (!tex) continue;
    container.replaceWith(
      mathPlaceholder(tex, container.getAttribute("display") === "true"),
    );
  }

  for (const container of Array.from(root.querySelectorAll(".katex"))) {
    const annotation = container.querySelector("annotation[encoding*='tex']");
    const tex = annotation?.textContent?.trim();
    if (!tex) {
      if (!container.classList.contains("aihub-provider-math")) {
        const fallback = document.createElement("span");
        fallback.className = "aihub-math-fallback";
        fallback.textContent = container.textContent || "";
        container.replaceWith(fallback);
      }
      continue;
    }
    const display = Boolean(container.closest(".katex-display"));
    const target = display ? container.closest(".katex-display") : container;
    target?.replaceWith(mathPlaceholder(tex, display));
  }

  for (const math of Array.from(root.querySelectorAll("math"))) {
    if (math.closest(".katex,mjx-container")) continue;
    const annotation = math.querySelector("annotation[encoding*='tex']");
    const tex = annotation?.textContent?.trim();
    if (!tex) continue;
    math.replaceWith(
      mathPlaceholder(tex, math.getAttribute("display") === "block"),
    );
  }
}

function renderFormulaPlaceholders(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(".aihub-math"))) {
    try {
      element.innerHTML = katex.renderToString(element.dataset.tex || "", {
        displayMode: element.dataset.display === "true",
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "html",
      });
      element.classList.add("aihub-provider-math");
    } catch {
      element.textContent = element.dataset.tex || "";
    }
  }
}

function pruneEmptyLayoutNodes(root: ParentNode): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("div,span,p,section,article"));
  for (const element of elements.reverse()) {
    if (element.classList.contains("aihub-math")) continue;
    if (element.classList.contains("aihub-provider-math")) continue;
    if (element.childElementCount > 0) continue;
    const hasMedia = Boolean(
      element.querySelector("img,video,canvas,svg,table,pre,code,math,mjx-container"),
    );
    if (hasMedia) continue;
    if (element.textContent?.trim()) continue;
    element.remove();
  }
}

export function renderProviderHtml(html: string, suppressImages = false): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  if (suppressImages) {
    template.content.querySelectorAll("img,picture").forEach((element) => element.remove());
  }
  replaceFormulaContainers(template.content);

  for (const element of Array.from(template.content.querySelectorAll<HTMLElement>("*"))) {
    if (DANGEROUS_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name === "src" || name === "poster") {
        const value = safeUrl(
          attribute.value,
          name === "href" ? "navigation" : "resource",
        );
        if (value) element.setAttribute(attribute.name, value);
        else element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "A") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  pruneEmptyLayoutNodes(template.content);
  renderFormulaPlaceholders(template.content);
  return template.innerHTML;
}
