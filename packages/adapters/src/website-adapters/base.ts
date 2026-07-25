import type {
  ContentBlock,
  ProviderId,
  WebsiteConversationRef,
  WebsiteConversationSnapshot,
  WebsiteMessageSnapshot,
} from "@aihub/core";
import { providerDefinitions, type ProviderDefinition } from "../definitions";

export interface ConversationAnchor {
  sequence: number;
  textSignature: string;
  elementSignature: string;
  messageKey?: string;
}

export interface NetworkMonitorConfig {
  urlPatterns: string[];
  urlPathEndsWith?: string[];
  silenceThresholdMs: number;
}

export interface AssistantBinding {
  element: HTMLElement;
  fallbackUsed: boolean;
  detail: string;
}

export interface WebsiteMessageElement {
  key: string;
  role: "user" | "assistant";
  order: number;
  element: HTMLElement;
}

export interface ConversationScanOptions {
  maxMessages?: number;
  maxRounds?: number;
  timeoutMs?: number;
}

export interface WebsiteAdapter {
  readonly provider: ProviderId;
  readonly definition: ProviderDefinition;
  findComposer(): HTMLElement | null;
  findSubmit(composer?: HTMLElement | null): HTMLElement | null;
  insertPrompt(composer: HTMLElement, text: string): Promise<boolean>;
  submit(composer: HTMLElement, submit?: HTMLElement | null): Promise<boolean>;
  captureAnchor(): ConversationAnchor;
  findAssistantAfterAnchor(anchor: ConversationAnchor): AssistantBinding | null;
  fallbackAssistant(): AssistantBinding | null;
  resolveContentRoot(element: HTMLElement): HTMLElement;
  extractText(element: HTMLElement): string;
  extractHtml(element: HTMLElement): string | undefined;
  extractContentBlocks(
    element: HTMLElement | undefined,
    text: string,
    html?: string,
  ): ContentBlock[];
  detectAuthInterruption(): string | undefined;
  findRecoverableBlocker(): string | undefined;
  hasUserTurnWithSnippet(snippet: string, composer: HTMLElement): boolean;
  isSubmitPending(submit?: HTMLElement | null): boolean;
  hasStreamingIndicator(root: HTMLElement | null): boolean;
  isGenerating(): boolean;
  getFirstTokenTimeoutMs(): number;
  getCompletionStableThresholdMs(): number;
  getNetworkMonitorConfig(): NetworkMonitorConfig | null;
  getCleanModeCss(): string;
  describeElement(element: Element | null): string;
  matchesLocation(): boolean;
  getCurrentConversation(): WebsiteConversationRef | null;
  listVisibleConversations(): WebsiteConversationRef[];
  getConversationListScrollContainer(): HTMLElement | null;
  getConversationMessageScrollContainer(): HTMLElement | null;
  messageElements(): WebsiteMessageElement[];
  extractConversationSnapshot(
    options?: ConversationScanOptions,
  ): Promise<WebsiteConversationSnapshot>;
}

function roots(): ParentNode[] {
  const visited = new Set<ParentNode>();
  const queue: ParentNode[] = [document];
  const all: ParentNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    all.push(current);
    if (!(current instanceof Document || current instanceof ShadowRoot)) continue;
    for (const element of current.querySelectorAll("*")) {
      if (element.shadowRoot) queue.push(element.shadowRoot);
    }
  }
  return all;
}

export function queryAllInPage<T extends HTMLElement = HTMLElement>(
  selector: string,
): T[] {
  const values: T[] = [];
  for (const root of roots()) {
    if (root instanceof Document || root instanceof ShadowRoot) {
      values.push(...Array.from(root.querySelectorAll<T>(selector)));
    }
  }
  return values;
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number.parseFloat(style.opacity || "1") === 0
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function normalizedText(element: HTMLElement): string {
  const value = readTextWithShadow(element);
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function srcsetCandidates(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim().split(/\s+/)[0] ?? "").filter(Boolean);
}

function absoluteResourceUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:image/svg")) return undefined;
  if (/^(data:image\/|blob:)/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed, location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function imageSource(image: HTMLImageElement): string | undefined {
  const values = [
    image.currentSrc,
    image.getAttribute("src"),
    image.getAttribute("data-src"),
    image.getAttribute("data-original"),
    image.getAttribute("data-image-src"),
    ...srcsetCandidates(image.getAttribute("srcset")).reverse(),
  ];
  const source = image.closest("picture")?.querySelector("source");
  if (source) values.push(...srcsetCandidates(source.getAttribute("srcset")).reverse());
  const resolved = values.map((value) => absoluteResourceUrl(value ?? "")).find(Boolean);
  if (!resolved?.startsWith("blob:") || !image.complete || image.naturalWidth === 0) {
    return resolved;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function isContentImage(image: HTMLImageElement, source: string): boolean {
  const label = `${image.className} ${image.alt} ${image.getAttribute("role") ?? ""}`;
  if (/avatar|icon|logo|emoji|badge|profile|watermark/i.test(label)) return false;
  const width = image.naturalWidth || Number(image.getAttribute("width")) || image.clientWidth;
  const height = image.naturalHeight || Number(image.getAttribute("height")) || image.clientHeight;
  if (width > 0 && height > 0 && width <= 64 && height <= 64) return false;
  return !/\/(avatar|icon|logo|emoji)(?:[/.?_-]|$)/i.test(source);
}

function readTextWithShadow(root: Node): string {
  if (root instanceof HTMLTextAreaElement || root instanceof HTMLInputElement) {
    return root.value;
  }
  if (root instanceof Text) {
    return root.textContent || "";
  }
  if (!(root instanceof Element)) {
    return root.textContent || "";
  }
  const text = root instanceof HTMLElement ? root.innerText || "" : "";
  if (text) return text;
  let value = "";
  for (const child of root.childNodes) {
    value += readTextWithShadow(child);
  }
  if (root instanceof HTMLElement && root.shadowRoot) {
    value += readTextWithShadow(root.shadowRoot);
  }
  return value;
}

function cloneElementWithShadow(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(false) as HTMLElement;
  for (const child of Array.from(element.childNodes)) {
    if (child instanceof HTMLElement) {
      clone.appendChild(cloneElementWithShadow(child));
    } else {
      clone.appendChild(child.cloneNode(true));
    }
  }
  if (element.shadowRoot) {
    const shadowHost = document.createElement("div");
    shadowHost.setAttribute("data-aihub-shadow-root", "true");
    for (const child of Array.from(element.shadowRoot.childNodes)) {
      if (child instanceof HTMLElement) {
        shadowHost.appendChild(cloneElementWithShadow(child));
      } else {
        shadowHost.appendChild(child.cloneNode(true));
      }
    }
    clone.appendChild(shadowHost);
  }
  return clone;
}

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

function mathBlockForElement(
  element: Element,
): Extract<ContentBlock, { type: "math" }> | undefined {
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

function elementSignature(element: HTMLElement): string {
  const id = element.id ? `#${element.id}` : "";
  const dataId =
    element.getAttribute("data-message-id") ||
    element.getAttribute("data-testid") ||
    element.getAttribute("data-turn-id") ||
    "";
  const className = String(element.className || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(".");
  return [element.tagName.toLowerCase(), id, className, dataId]
    .filter(Boolean)
    .join(":");
}

function textHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function canonicalUrl(value = location.href): string {
  try {
    const url = new URL(value, location.href);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function documentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  const position = left.compareDocumentPosition(right);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function hasToken(value: string | null | undefined, pattern: RegExp): boolean {
  return pattern.test(String(value ?? ""));
}

function isLikelyUserTurn(element: HTMLElement): boolean {
  const role =
    element.getAttribute("data-message-author-role") ||
    element.getAttribute("data-role") ||
    element.getAttribute("data-message-role") ||
    element.getAttribute("data-testid") ||
    "";
  if (/\buser\b|human|customer|question|prompt/i.test(role)) return true;
  if (element.matches("[data-message-author-role='user'],[data-role='user'],[data-message-role='user']")) {
    return true;
  }
  if (element.closest("[data-message-author-role='user'],[data-role='user'],[data-message-role='user']")) {
    return true;
  }
  if (element.closest(".justify-end,[class*='justify-end']")) {
    return true;
  }
  const className = String(element.className || "");
  if (/\b(user|human|question|prompt)-?(message|bubble|content|turn)?\b/i.test(className)) {
    return true;
  }
  if (element.matches(".justify-end,[class*='justify-end'],[class*='user-message'],[class*='human-message']")) {
    return true;
  }
  return false;
}

function isLikelyChromeOrRecommendation(element: HTMLElement): boolean {
  if (element.closest("footer,nav,aside,form")) return true;
  const combined = [
    element.id,
    element.getAttribute("role"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("data-card-type"),
    String(element.className || ""),
  ].join(" ");
  if (hasToken(combined, /recommend|suggest|example|starter|prompt-card|quick|shortcut|toolbar|action|copy|share|feedback|vote|login|banner|advert|sidebar|menu/i)) {
    return true;
  }
  return false;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, text);
  else element.value = text;
}

function dispatchInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: text,
    inputType: "insertText",
  }));
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    data: text,
    inputType: "insertText",
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectContents(element: HTMLElement): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export class DefaultWebsiteAdapter implements WebsiteAdapter {
  readonly provider: ProviderId;
  readonly definition: ProviderDefinition;

  constructor(provider: ProviderId) {
    this.provider = provider;
    this.definition = providerDefinitions[provider];
  }

  matchesLocation(): boolean {
    return this.definition.allowedOrigins.includes(location.origin);
  }

  getCurrentConversation(): WebsiteConversationRef | null {
    const url = canonicalUrl();
    const match = this.definition.conversationUrlPattern?.exec(location.href);
    const externalId = match?.[1] || (url !== this.definition.loginUrl ? url : "");
    if (!externalId) return null;
    return {
      externalId,
      title: document.title.trim() || `${this.provider} conversation`,
      url,
      isActive: true,
    };
  }

  listVisibleConversations(): WebsiteConversationRef[] {
    const values = new Map<string, WebsiteConversationRef>();
    for (const link of queryAllInPage<HTMLAnchorElement>("a[href]")) {
      const href = link.href;
      const match = this.definition.conversationUrlPattern?.exec(href);
      const externalId = match?.[1];
      if (!externalId || values.has(externalId)) continue;
      const title = (
        link.getAttribute("title") ||
        link.getAttribute("aria-label") ||
        normalizedText(link)
      ).replace(/\s+/g, " ").trim();
      if (!title) continue;
      values.set(externalId, {
        externalId,
        title,
        url: canonicalUrl(href),
        isActive: link.getAttribute("aria-current") === "page" ||
          link.hasAttribute("data-active") ||
          link.className.includes("active"),
        isPinned: Boolean(link.closest("[data-pinned], [class*='pinned'], [class*='pin-list']")),
      });
    }
    return Array.from(values.values()).slice(0, 500);
  }

  getConversationListScrollContainer(): HTMLElement | null {
    const first = queryAllInPage<HTMLAnchorElement>("a[href]").find((link) =>
      Boolean(this.definition.conversationUrlPattern?.test(link.href)));
    let current = first?.parentElement ?? null;
    while (current) {
      const style = window.getComputedStyle(current);
      if (/auto|scroll/.test(style.overflowY) || current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return first?.closest<HTMLElement>("nav,aside") ?? null;
  }

  getConversationMessageScrollContainer(): HTMLElement | null {
    const selectors = this.definition.conversationDocumentSelectors ?? [];
    for (const selector of selectors) {
      const candidate = queryAllInPage(selector).find((element) => {
        const style = window.getComputedStyle(element);
        return /auto|scroll/.test(style.overflowY) || element.scrollHeight > element.clientHeight;
      });
      if (candidate) return candidate;
    }
    return null;
  }

  messageElements(): WebsiteMessageElement[] {
    const selected = this.collectSemanticMessageElements()
      .sort((left, right) => documentOrder(left.element, right.element));
    const conversationId =
      this.getCurrentConversation()?.externalId ?? canonicalUrl();
    const conversationKey = textHash(conversationId);
    let latestUserKey = `${conversationKey}:no-user`;
    const assistantCounts = new Map<string, number>();
    return selected.map((entry, order) => {
      const explicit = this.explicitMessageKey(entry.element);
      let key: string;
      if (explicit) {
        key = `${entry.role}:${explicit}`;
      } else if (entry.role === "user") {
        key = `${conversationKey}:user:text-${textHash(normalizedText(entry.element).slice(0, 2_000))}`;
      } else {
        const count = assistantCounts.get(latestUserKey) ?? 0;
        assistantCounts.set(latestUserKey, count + 1);
        key = `${conversationKey}:assistant:after-${latestUserKey}:${count}`;
      }
      if (entry.role === "user") latestUserKey = key;
      return { ...entry, key, order };
    });
  }

  async extractConversationSnapshot(
    options: ConversationScanOptions = {},
  ): Promise<WebsiteConversationSnapshot> {
    const maxMessages = Math.min(1_000, Math.max(1, options.maxMessages ?? 1_000));
    const maxRounds = Math.min(60, Math.max(1, options.maxRounds ?? 30));
    const timeoutMs = Math.min(60_000, Math.max(1_000, options.timeoutMs ?? 20_000));
    const startedAt = Date.now();
    const collected = new Map<string, WebsiteMessageSnapshot>();
    let discoveryOrder = 0;
    const scrollContainer = this.getConversationMessageScrollContainer();
    const originalScrollTop = scrollContainer?.scrollTop ?? 0;
    let rounds = 0;
    let stableRounds = 0;
    let limitReached = false;

    const collect = () => {
      const before = collected.size;
      for (const message of this.messageElements()) {
        const html = message.role === "assistant"
          ? this.extractHtml(message.element)
          : undefined;
        const text = html
          ? (() => {
              const container = document.createElement("div");
              container.innerHTML = html;
              return normalizedText(container);
            })()
          : this.extractText(message.element);
        if (!text) continue;
        const content = message.role === "assistant"
          ? this.extractContentBlocks(message.element, text, html)
          : [{ type: "text" as const, text }];
        const existing = collected.get(message.key);
        collected.set(message.key, {
          key: message.key,
          role: message.role,
          order: existing?.order ?? discoveryOrder++,
          content,
          providerHtml: html,
        });
        if (collected.size >= maxMessages) {
          limitReached = true;
          break;
        }
      }
      stableRounds = collected.size === before ? stableRounds + 1 : 0;
    };

    try {
      collect();
      if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
        scrollContainer.scrollTop = 0;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        for (rounds = 1; rounds <= maxRounds; rounds += 1) {
          collect();
          if (limitReached || Date.now() - startedAt >= timeoutMs) break;
          const viewport = Math.max(200, scrollContainer.clientHeight * 0.8);
          const next = Math.min(
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
            scrollContainer.scrollTop + viewport,
          );
          if (next <= scrollContainer.scrollTop && stableRounds >= 2) break;
          scrollContainer.scrollTop = next;
          scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
          await new Promise((resolve) => window.setTimeout(resolve, 120));
        }
        collect();
      }
    } finally {
      if (scrollContainer) {
        scrollContainer.scrollTop = originalScrollTop;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    }

    const conversation = this.getCurrentConversation();
    const messages = Array.from(collected.values()).sort((left, right) =>
      left.order - right.order || left.key.localeCompare(right.key));
    return {
      externalId: conversation?.externalId || canonicalUrl(),
      title: conversation?.title || document.title.trim() || `${this.provider} conversation`,
      url: conversation?.url || canonicalUrl(),
      messages,
      scanRounds: rounds,
      partial: limitReached || Date.now() - startedAt >= timeoutMs,
      limitReached,
      fallbackReason: messages.length === 0 ? "no-semantic-message-elements" : undefined,
    };
  }

  findComposer(): HTMLElement | null {
    return this.firstVisible(this.definition.composerSelectors);
  }

  findSubmit(composer?: HTMLElement | null): HTMLElement | null {
    const buttons = this.definition.submitSelectors
      .flatMap((selector) => queryAllInPage(selector))
      .filter(visible);
    if (buttons.length === 0) return null;
    const form = composer?.closest("form");
    if (form) {
      const inForm = buttons.find((button) => button.closest("form") === form);
      if (inForm) return inForm;
    }
    return buttons[0] ?? null;
  }

  async insertPrompt(composer: HTMLElement, text: string): Promise<boolean> {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      setNativeValue(composer, text);
      dispatchInput(composer, text);
      return normalizedText(composer).includes(text.slice(0, 10));
    }

    const data = new DataTransfer();
    data.setData("text/plain", text);
    composer.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: data,
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    if (normalizedText(composer).includes(text.slice(0, 10))) return true;

    selectContents(composer);
    if (document.execCommand("insertText", false, text)) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (normalizedText(composer).includes(text.slice(0, 10))) return true;
    }

    composer.textContent = text;
    dispatchInput(composer, text);
    return normalizedText(composer).includes(text.slice(0, 10));
  }

  async submit(composer: HTMLElement, submit?: HTMLElement | null): Promise<boolean> {
    if (submit) {
      submit.click();
      return true;
    }
    if (!this.definition.submitWithEnter) return false;
    composer.focus();
    for (const type of ["keydown", "keypress", "keyup"] as const) {
      composer.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        composed: true,
        cancelable: true,
      }));
    }
    return true;
  }

  captureAnchor(): ConversationAnchor {
    const semantic = this.messageElements().filter((message) => message.role === "assistant");
    const candidates = semantic.map((message) => message.element);
    const last = candidates.at(-1);
    const lastMessage = semantic.at(-1);
    const text = last ? normalizedText(last) : "";
    return {
      sequence: candidates.length,
      textSignature: text.slice(-160),
      elementSignature: last ? elementSignature(last) : "none",
      messageKey: lastMessage?.key,
    };
  }

  findAssistantAfterAnchor(anchor: ConversationAnchor): AssistantBinding | null {
    const candidates = this.assistantCandidates();
    const anchorIndex = this.findAnchorIndex(candidates, anchor);
    const after = candidates.slice(anchorIndex + 1);
    const selected = this.pickLastMeaningful(after);
    if (!selected) return null;
    return {
      element: selected,
      fallbackUsed: false,
      detail: `bound-after-anchor:${anchorIndex + 1}->${candidates.length}`,
    };
  }

  fallbackAssistant(): AssistantBinding | null {
    const selected = this.pickLastMeaningful(this.assistantCandidates());
    if (!selected) return null;
    return {
      element: selected,
      fallbackUsed: true,
      detail: "fallback-latest-visible-assistant",
    };
  }

  resolveContentRoot(element: HTMLElement): HTMLElement {
    return element;
  }

  extractText(element: HTMLElement): string {
    return normalizedText(this.resolveContentRoot(element));
  }

  extractHtml(element: HTMLElement): string | undefined {
    const clone = cloneElementWithShadow(this.resolveContentRoot(element));
    clone.querySelectorAll(
      "button,nav,footer,header,script,style,iframe,form,input,textarea,select,[role='button']",
    ).forEach((candidate) => candidate.remove());
    clone.querySelectorAll(
      "[class*='message-action']," +
        "[class*='suggest']," +
        "[class*='bottom-placeholder']," +
        "[class*='bottom-item']," +
        "[class*='to-bottom-button']," +
        "[class*='carousel']," +
        "[class*='assistant-actions']," +
        "[class*='message-actions']," +
        "[class*='toolbar']," +
        "[data-visible='false']," +
        "[aria-hidden='true']",
    ).forEach((candidate) => candidate.remove());
    clone.querySelectorAll<HTMLElement>("*").forEach((candidate) => {
      for (const attribute of Array.from(candidate.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc") {
          candidate.removeAttribute(attribute.name);
        }
      }
    });
    const html = clone.innerHTML.trim();
    return html || undefined;
  }

  extractContentBlocks(
    element: HTMLElement | undefined,
    text: string,
    html?: string,
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    const seen = new Set<string>();

    if (text.trim()) {
      blocks.push({ type: "text", text });
    }

    const contentRoot = element ? this.resolveContentRoot(element) : undefined;

    if (contentRoot) {
      const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_ELEMENT);
      let current = walker.nextNode();
      while (current) {
        const candidate = current as Element;
        if (candidate instanceof HTMLImageElement) {
          const src = imageSource(candidate);
          if (src && isContentImage(candidate, src)) {
            pushUnique(blocks, seen, `image:${src}`, {
              type: "image",
              src,
              alt: candidate.getAttribute("alt")?.trim() || undefined,
              title: candidate.getAttribute("title")?.trim() || undefined,
            });
          }
        }

        const math = mathBlockForElement(candidate);
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

  detectAuthInterruption(): string | undefined {
    const composer = this.findComposer();
    const submit = this.findSubmit(composer);
    const authBlocker = (this.definition.authBlockerSelectors ?? [])
      .flatMap((selector) => queryAllInPage<HTMLElement>(selector))
      .find((candidate) => visible(candidate));
    if (authBlocker) {
      return "Login or provider verification is blocking the composer.";
    }
    const loginMarker = this.firstVisible(this.definition.loginMarkers);
    if (loginMarker && !submit && !this.definition.submitWithEnter) {
      return "Login or provider verification is required before sending.";
    }
    if (composer && (submit || this.definition.submitWithEnter)) {
      return undefined;
    }
    const bodyText = document.body.innerText;
    if (
      /login|sign in|verification|captcha|phone|\+86/i.test(bodyText) &&
      /next step|phone|\+86|verify|captcha/i.test(bodyText.toLowerCase())
    ) {
      return "Login or provider verification interrupted message submission.";
    }
    return undefined;
  }

  findRecoverableBlocker(): string | undefined {
    const configured = (this.definition.authBlockerSelectors ?? [])
      .flatMap((selector) => queryAllInPage<HTMLElement>(selector))
      .find((candidate) => visible(candidate));
    if (configured) {
      return "Login or provider verification is blocking the provider page.";
    }
    const genericBlockers = queryAllInPage<HTMLElement>(
      "[role='alert']," +
        "[role='dialog']," +
        "[aria-modal='true']," +
        "[class*='captcha']," +
        "[class*='verify']," +
        "[class*='verification']," +
        "[class*='error']," +
        "[class*='modal']," +
        "[class*='toast']",
    );
    for (const candidate of genericBlockers) {
      if (!visible(candidate)) continue;
      const text = normalizedText(candidate);
      if (!text) continue;
      if (/captcha/i.test(text)) return text;
      if (/login|sign in/i.test(text)) return text;
      if (/verify|verification|human|security/i.test(text)) return text;
      if (/rate limit|too many/i.test(text)) return text;
      if (/error|failed|try again/i.test(text)) return text;
    }
    return undefined;
  }

  hasUserTurnWithSnippet(snippet: string, composer: HTMLElement): boolean {
    if (!snippet) return false;
    const candidates = queryAllInPage<HTMLElement>(
      "[data-message-author-role='user']," +
        "[data-role='user']," +
        "[data-message-role='user']," +
        "[data-testid*='user']," +
        "[class*='user-message']," +
        "[class*='human-message']," +
        ".justify-end",
    );
    return candidates.some((candidate) => {
      if (candidate === composer || candidate.contains(composer)) return false;
      if (!visible(candidate)) return false;
      return normalizedText(candidate).includes(snippet);
    });
  }

  isSubmitPending(submit?: HTMLElement | null): boolean {
    if (!submit) return false;
    if (submit instanceof HTMLButtonElement && submit.disabled) return true;
    return submit.getAttribute("aria-disabled") === "true" ||
      submit.getAttribute("data-disabled") === "true" ||
      submit.getAttribute("data-state") === "loading" ||
      submit.getAttribute("aria-busy") === "true" ||
      /\b(disabled|loading|pending|busy)\b/i.test(String(submit.className || ""));
  }

  hasStreamingIndicator(root: HTMLElement | null): boolean {
    if (!root) return false;
    if (root.matches("[data-streaming='true'],[aria-busy='true'],[role='progressbar']")) {
      return true;
    }
    return Boolean(
      root.querySelector(
        "[data-streaming='true']," +
          "[aria-busy='true']," +
          "[role='progressbar']," +
          "[class*='typing']," +
          "[class*='loading']",
      ),
    );
  }

  isGenerating(): boolean {
    return this.definition.stopSelectors
      .flatMap((selector) => queryAllInPage(selector))
      .some(visible);
  }

  getFirstTokenTimeoutMs(): number {
    return 120_000;
  }

  getCompletionStableThresholdMs(): number {
    return 2_500;
  }

  getNetworkMonitorConfig(): NetworkMonitorConfig | null {
    return null;
  }

  getCleanModeCss(): string {
    return [
      "aside, nav, header { display: none !important; }",
      "[class*='sidebar'], [class*='recommend'], [class*='suggest'] { display: none !important; }",
    ].join("\n");
  }

  describeElement(element: Element | null): string {
    if (!(element instanceof HTMLElement)) return "none";
    const text = normalizedText(element);
    return `${elementSignature(element)} visible=${visible(element)} text=${text.length}`;
  }

  protected firstVisible(selectors: readonly string[]): HTMLElement | null {
    for (const selector of selectors) {
      const element = queryAllInPage(selector).find(visible);
      if (element) return element;
    }
    return null;
  }

  protected assistantCandidates(): HTMLElement[] {
    const semantic = this.messageElements()
      .filter((message) => message.role === "assistant")
      .map((message) => message.element);
    if (semantic.length > 0) return semantic;
    const seen = new Set<HTMLElement>();
    const candidates: HTMLElement[] = [];
    for (const selector of this.definition.assistantMessageSelectors) {
      for (const element of queryAllInPage(selector)) {
        if (seen.has(element) || !visible(element)) continue;
        if (this.shouldIgnoreAssistantCandidate(element)) continue;
        seen.add(element);
        candidates.push(element);
      }
    }
    return this.sortAssistantCandidates(candidates.sort(documentOrder));
  }

  protected shouldIgnoreAssistantCandidate(element: HTMLElement): boolean {
    return isLikelyChromeOrRecommendation(element) || isLikelyUserTurn(element);
  }

  protected sortAssistantCandidates(candidates: HTMLElement[]): HTMLElement[] {
    return candidates;
  }

  protected pickLastMeaningful(candidates: HTMLElement[]): HTMLElement | null {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      if (normalizedText(candidate).length > 0) return candidate;
    }
    return null;
  }

  protected findAnchorIndex(
    candidates: HTMLElement[],
    anchor: ConversationAnchor,
  ): number {
    if (anchor.messageKey) {
      const semantic = this.messageElements().filter((message) => message.role === "assistant");
      const index = semantic.findIndex((message) => message.key === anchor.messageKey);
      if (index >= 0) return index;
    }
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      if (
        elementSignature(candidate) === anchor.elementSignature &&
        (!anchor.textSignature || normalizedText(candidate).endsWith(anchor.textSignature))
      ) {
        return index;
      }
    }
    if (anchor.textSignature) {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if (!candidate) continue;
        if (normalizedText(candidate).endsWith(anchor.textSignature)) return index;
      }
    }
    return Math.max(-1, Math.min(anchor.sequence - 1, candidates.length - 1));
  }

  protected turnSelectors(): readonly string[] {
    return [];
  }

  protected userMessageSelectors(): readonly string[] {
    return [
      "[data-message-author-role='user']",
      "[data-role='user']",
      "[data-message-role='user']",
      "[class*='user-message']",
    ];
  }

  protected assistantMessageSelectors(): readonly string[] {
    return this.definition.assistantMessageSelectors;
  }

  protected messageKey(element: HTMLElement, role: "user" | "assistant"): string {
    const stable = this.explicitMessageKey(element);
    if (stable) return `${role}:${stable}`;
    return `${role}:text-${textHash(normalizedText(element).slice(0, 500))}`;
  }

  protected explicitMessageKey(element: HTMLElement): string | undefined {
    const direct =
      element.getAttribute("data-message-id") ||
      element.getAttribute("data-turn-id") ||
      element.getAttribute("data-id") ||
      element.id;
    if (direct) return direct;
    const ancestor = element.closest<HTMLElement>(
      "[data-message-id],[data-turn-id],[data-id],[id]",
    );
    const inherited =
      ancestor?.getAttribute("data-message-id") ||
      ancestor?.getAttribute("data-turn-id") ||
      ancestor?.getAttribute("data-id") ||
      ancestor?.id;
    if (inherited) return inherited;
    const testId = element.getAttribute("data-testid");
    return testId && /(?:\d|[a-f0-9]{8}-)/i.test(testId)
      ? testId
      : undefined;
  }

  private collectSemanticMessageElements(): Array<Omit<WebsiteMessageElement, "order">> {
    const entries: Array<Omit<WebsiteMessageElement, "order">> = [];
    const seen = new Set<HTMLElement>();
    const push = (element: HTMLElement, role: "user" | "assistant") => {
      if (seen.has(element) || !visible(element)) return;
      if (isLikelyChromeOrRecommendation(element)) return;
      if (role === "assistant" && isLikelyUserTurn(element)) return;
      seen.add(element);
      entries.push({ key: this.messageKey(element, role), role, element });
    };
    const collectWithin = (root: ParentNode) => {
      for (const selector of this.userMessageSelectors()) {
        if (root instanceof HTMLElement && root.matches(selector)) push(root, "user");
        root.querySelectorAll<HTMLElement>(selector).forEach((element) => push(element, "user"));
      }
      for (const selector of this.assistantMessageSelectors()) {
        if (root instanceof HTMLElement && root.matches(selector)) push(root, "assistant");
        root.querySelectorAll<HTMLElement>(selector).forEach((element) => push(element, "assistant"));
      }
    };
    const turns = this.turnSelectors().flatMap((selector) => queryAllInPage(selector));
    if (turns.length > 0) turns.forEach(collectWithin);
    else collectWithin(document);
    return entries.filter((entry) => !entries.some((other) =>
      other !== entry &&
      other.role === entry.role &&
      other.element.contains(entry.element)));
  }
}
