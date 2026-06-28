import { ipcRenderer } from "electron";
import {
  providerDefinitions,
  type ProviderDefinition,
} from "@aihub/adapters";
import type {
  AttachmentKind,
  NormalizedMessage,
  ProviderEvent,
  ProviderId,
  ProviderMode,
  ProviderState,
  ProviderSendPhase,
} from "@aihub/core";
import { pickAssistantElement } from "./provider-assistant-selection";
import { resolveGenerationCheck } from "./provider-generation-policy";
import { plainTextWithShadow } from "./provider-dom-text";
import { cloneElementWithShadow } from "./provider-dom-clone";
import { buildAssistantContentBlocks } from "./provider-content-blocks";

interface ProviderCommand {
  requestId: string;
  type:
    | "detect-state"
    | "send-message"
    | "cancel-generation"
    | "prepare-attachments"
    | "wait-attachments"
    | "configure-mode"
    | "discover-models"
    | "configure-model";
  payload?: {
    text?: string;
    names?: string[];
    modes?: string[];
    model?: string;
    attachmentMode?: "image" | "document";
    mode?: ProviderMode;
    enabled?: boolean;
  };
}

const providerArgument = process.argv.find((value) =>
  value.startsWith("--aihub-provider="),
);
const provider = providerArgument?.split("=")[1] as ProviderId | undefined;
if (!provider || !(provider in providerDefinitions)) {
  throw new Error("Missing or invalid provider preload argument.");
}

const providerId: ProviderId = provider;
const definition: ProviderDefinition = providerDefinitions[providerId];
let observer: MutationObserver | undefined;
let activeMessageId: string | undefined;
let latestText = "";
let latestContent: NormalizedMessage["content"] = [];
let lastMutationAt = 0;
let generationStartedAt = 0;
let completionTimer: number | undefined;
let lastAuthState: boolean | undefined;
let conversationBaseline = "";
let assistantBaseline = "";
let lastCapabilities = "";
let capabilityTimer: number | undefined;
let streamFlushTimer: number | undefined;
let pendingSnapshotText: string | undefined;
let pendingProviderHtml: string | undefined;
let pendingSnapshotContent: NormalizedMessage["content"] | undefined;

const STREAM_FLUSH_MS = 80;

function emit(event: ProviderEvent): void {
  ipcRenderer.send("provider:event", event);
}

function emitStatus(phase: ProviderSendPhase, detail?: string): void {
  emit({
    type: "message.status",
    messageId: activeMessageId,
    phase,
    detail,
  });
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
    if (!(current instanceof Document || current instanceof ShadowRoot)) {
      continue;
    }
    const elements = current.querySelectorAll("*");
    for (const element of elements) {
      if (element.shadowRoot) queue.push(element.shadowRoot);
    }
  }
  return all;
}

function queryAllInRoots<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  const values: T[] = [];
  for (const root of roots()) {
    if (!(root instanceof Document || root instanceof ShadowRoot)) continue;
    values.push(...Array.from(root.querySelectorAll<T>(selector)));
  }
  return values;
}

function firstInRoots(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = queryAllInRoots(selector)[0];
    if (element) return element;
  }
  return null;
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function detectState(): ProviderState {
  const composer = firstInRoots(definition.composerSelectors);
  const submit = firstInRoots(definition.submitSelectors);
  const loginMarker = firstInRoots(definition.loginMarkers);
  const authBlocker = (definition.authBlockerSelectors ?? [])
    .flatMap((selector) => queryAllInRoots<HTMLElement>(selector))
    .find((candidate) => visible(candidate));
  const teaserComposer = Boolean(composer) && !submit && Boolean(loginMarker);
  const authenticated = Boolean(composer) && !authBlocker && !teaserComposer;
  return {
    authenticated,
    ready: authenticated,
    degraded: false,
    reason: authenticated
      ? undefined
      : authBlocker
        ? "Login or provider verification is blocking the composer."
        : teaserComposer
          ? "Login or provider verification is required before sending."
        : loginMarker
          ? "Login or provider verification is required."
          : "The provider composer is not ready yet.",
  };
}

function authInterruptionReason(): string | undefined {
  const authBlocker = (definition.authBlockerSelectors ?? [])
    .flatMap((selector) => queryAllInRoots<HTMLElement>(selector))
    .find((candidate) => visible(candidate));
  if (authBlocker) {
    return "Login or provider verification is blocking the composer.";
  }
  const loginMarker = firstInRoots(definition.loginMarkers);
  if (loginMarker && !firstInRoots(definition.submitSelectors)) {
    return "Login or provider verification is required before sending.";
  }
  const bodyText = document.body.innerText;
  if (
    /登录|手机号|下一步|用户协议|隐私政策/i.test(bodyText) &&
    /next step|phone|\+86/i.test(bodyText.toLowerCase())
  ) {
    return "Login or provider verification interrupted message submission.";
  }
  return undefined;
}

function emitAuthIfChanged(): void {
  const authenticated = detectState().authenticated;
  if (authenticated !== lastAuthState) {
    lastAuthState = authenticated;
    emit({ type: "auth.changed", authenticated });
  }
}

function controlLabel(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.innerText ??
    element.textContent ??
    ""
  ).replace(/\s+/g, " ").trim();
}

function controlEnabled(element: HTMLElement): boolean {
  return element.getAttribute("aria-pressed") === "true" ||
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("data-state") === "on" ||
    element.getAttribute("data-state") === "checked" ||
    /(^|\s)(active|selected|checked|enabled)(\s|$)/i.test(element.className);
}

function findControl(labels: string[], excluded?: HTMLElement): HTMLElement | undefined {
  const normalized = labels.map((label) => label.toLowerCase());
  return queryAllInRoots<HTMLElement>(
    "button,[role='button'],[role='checkbox'],[role='switch'],[role='menuitem']," +
      "[aria-pressed],[data-state],[class*='mode'],[class*='tool'],[class*='menu']",
  ).find((element) => {
    if (element === excluded) return false;
    const label = controlLabel(element).toLowerCase();
    return visible(element) &&
      normalized.some((candidate) => label === candidate || label.includes(candidate));
  });
}

function findModeControl(mode: ProviderMode): HTMLElement | undefined {
  const modeDefinition = definition.modeDefinitions.find(
    (candidate) => candidate.mode === mode,
  );
  return modeDefinition ? findControl(modeDefinition.matchLabels) : undefined;
}

function currentModeState(
  modeDefinition: ProviderDefinition["modeDefinitions"][number],
): { available: boolean; enabled: boolean; opener?: HTMLElement } {
  const opener = findControl(modeDefinition.openerLabels ?? []);
  const openerLabel = opener ? controlLabel(opener).toLowerCase() : "";
  const directControl = findModeControl(modeDefinition.mode);
  let enabled = directControl ? controlEnabled(directControl) : false;
  if (modeDefinition.matchLabels.some((label) => {
    const value = label.toLowerCase();
    return openerLabel === value || openerLabel.includes(value);
  })) enabled = true;
  if ((modeDefinition.disabledLabels ?? []).some((label) => {
    const value = label.toLowerCase();
    return openerLabel === value || openerLabel.includes(value);
  })) enabled = false;
  return {
    available: Boolean(directControl || opener),
    enabled,
    opener,
  };
}

function attachmentKinds(accept: string): AttachmentKind[] {
  if (!accept.trim()) {
    return ["image", "pdf", "word", "excel", "powerpoint", "text"];
  }
  const value = accept.toLowerCase();
  const kinds = new Set<AttachmentKind>();
  if (/image|png|jpe?g|webp|gif/.test(value)) kinds.add("image");
  if (/pdf/.test(value)) kinds.add("pdf");
  if (/word|docx?/.test(value)) kinds.add("word");
  if (/excel|spreadsheet|xlsx?|csv/.test(value)) kinds.add("excel");
  if (/powerpoint|presentation|pptx?/.test(value)) kinds.add("powerpoint");
  if (/text|plain|markdown|\.txt|\.md/.test(value)) kinds.add("text");
  return Array.from(kinds);
}

function modelControlElement(): HTMLElement | undefined {
  for (const selector of definition.modelControlSelectors) {
    const match = queryAllInRoots<HTMLElement>(selector).find((candidate) =>
      visible(candidate)
    );
    if (match) return match;
  }
  return undefined;
}

function modelOptionElements(): HTMLElement[] {
  return queryAllInRoots<HTMLElement>(
    "option,[role='option'],[role='menuitem']," +
      "[data-testid*='model-option'],[class*='model-option']," +
      ".model-item-content,[role='dialog'] .cursor-pointer",
  ).filter((element) => element instanceof HTMLOptionElement || visible(element));
}

function modelOptionLabel(element: HTMLElement): string {
  return element.querySelector<HTMLElement>(".name,.truncate")?.textContent?.trim() ||
    controlLabel(element);
}

function detectCapabilities(): ProviderEvent & { type: "capabilities.changed" } {
  const fileInput = definition.fileInputSelectors
    .flatMap((selector) => queryAllInRoots<HTMLInputElement>(selector))
    .find((candidate) => candidate instanceof HTMLInputElement);
  const modelControl = modelControlElement();
  const models = modelControl instanceof HTMLSelectElement
    ? Array.from(modelControl.options)
      .filter((option) => option.value || option.textContent?.trim())
      .map((option) => ({
        id: option.value || option.textContent!.trim(),
        label: option.textContent?.trim() || option.value,
      }))
    : modelOptionElements()
      .map((option) => {
        const label = modelOptionLabel(option);
        return {
          id: option.getAttribute("data-value") ?? option.getAttribute("value") ?? label,
          label,
        };
      })
      .filter((option) => option.label);
  const model = modelControl instanceof HTMLSelectElement
    ? modelControl.value
    : modelControl
      ? controlLabel(modelControl)
      : undefined;
  if (model && !models.some((option) => option.label === model)) {
    models.unshift({ id: model, label: model });
  }
  return {
    type: "capabilities.changed",
    capabilities: {
      attachments: fileInput ? attachmentKinds(fileInput.accept) : [],
      modes: definition.modeDefinitions.flatMap((item) => {
        const state = currentModeState(item);
        return state.available
          ? [{ mode: item.mode, label: item.label, enabled: state.enabled }]
          : [];
      }),
      model: model || undefined,
      models,
      multipleAttachments: fileInput?.multiple ?? false,
      acceptedTypes: fileInput?.accept
        ? fileInput.accept.split(",").map((item) => item.trim()).filter(Boolean)
        : [],
    },
  };
}

function scheduleCapabilityDetection(): void {
  if (capabilityTimer) window.clearTimeout(capabilityTimer);
  capabilityTimer = window.setTimeout(() => {
    const event = detectCapabilities();
    const serialized = JSON.stringify(event.capabilities);
    if (serialized !== lastCapabilities) {
      lastCapabilities = serialized;
      emit(event);
    }
  }, 120);
}

function assistantElement(): HTMLElement | undefined {
  return pickAssistantElement(
    providerId,
    definition.assistantMessageSelectors,
    (selector) => queryAllInRoots<HTMLElement>(selector),
  );
}

function normalizedConversationText(root: HTMLElement): string {
  return plainTextWithShadow(root)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getAssistantText(): string {
  const selected = assistantElement();
  const assistantText = selected ? normalizedConversationText(selected) : "";
  let conversationDelta = "";
  if (definition.conversationDocumentSelectors?.length) {
    const documentRoot = firstInRoots(definition.conversationDocumentSelectors);
    if (documentRoot) {
      const fullText = normalizedConversationText(documentRoot);
      if (conversationBaseline) {
        conversationDelta = cleanConversationDelta(
          conversationTextDelta(conversationBaseline, fullText),
        );
      }
    }
  }
  if (assistantText && assistantText !== assistantBaseline) {
    if (
      conversationDelta &&
      conversationDelta.length > assistantText.length &&
      (
        conversationDelta.startsWith(assistantText) ||
        (latestText && conversationDelta.startsWith(latestText))
      )
    ) {
      return conversationDelta;
    }
    return assistantText;
  }
  return conversationDelta;
}

function getAssistantHtml(): string | undefined {
  const source = assistantElement();
  if (!source) return undefined;
  const clone = cloneElementWithShadow(source);
  clone.querySelectorAll(
    "button,nav,footer,header,script,style,iframe,form,input,textarea,select,[role='button']",
  ).forEach((element) => element.remove());
  clone.querySelectorAll(
    "[class*='message-action']," +
      "[class*='suggest']," +
      "[class*='bottom-placeholder']," +
      "[class*='bottom-item']," +
      "[class*='to-bottom-button']," +
      "[class*='carousel']," +
      "[data-visible='false']," +
      "[aria-hidden='true']",
  ).forEach((element) => element.remove());
  clone.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
    }
  });
  const html = clone.innerHTML.trim();
  return html || undefined;
}

function getAssistantContent(
  text: string,
  providerHtml?: string,
): NormalizedMessage["content"] {
  return buildAssistantContentBlocks(
    assistantElement(),
    text,
    providerHtml,
  );
}

function conversationTextDelta(before: string, after: string): string {
  let prefixLength = 0;
  const limit = Math.min(before.length, after.length);
  while (prefixLength < limit && before.charCodeAt(prefixLength) === after.charCodeAt(prefixLength)) {
    prefixLength += 1;
  }
  return after.slice(prefixLength).trim();
}

function cleanConversationDelta(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function captureConversationBaseline(): void {
  const assistant = assistantElement();
  assistantBaseline = assistant ? normalizedConversationText(assistant) : "";
  if (!definition.conversationDocumentSelectors?.length) {
    conversationBaseline = "";
    return;
  }
  const root = firstInRoots(definition.conversationDocumentSelectors);
  conversationBaseline = root ? normalizedConversationText(root) : "";
}

function hasStopButton(): boolean {
  return Boolean(firstInRoots(definition.stopSelectors));
}

function hasStreamingIndicator(): boolean {
  const root = assistantElement() ??
    (definition.conversationDocumentSelectors?.length
      ? firstInRoots(definition.conversationDocumentSelectors)
      : null);
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

function flushStreamUpdate(force = false): void {
  if (streamFlushTimer) {
    window.clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }
  if (!activeMessageId) return;
  const nextText = pendingSnapshotText ?? latestText;
  const providerHtml = pendingProviderHtml;
  const nextContent = pendingSnapshotContent ?? latestContent;
  pendingSnapshotText = undefined;
  pendingProviderHtml = undefined;
  pendingSnapshotContent = undefined;
  if (!nextText && !providerHtml && nextContent.length === 0) return;
  if (!nextText || nextText === latestText) {
    if (providerHtml || nextContent.length > 0 || force) {
      latestContent = nextContent;
      emit({
        type: "message.snapshot",
        messageId: activeMessageId,
        content: nextContent,
        text: latestText,
        providerHtml,
        phase: latestText ? "streaming" : "waiting-first-token",
      });
    }
    return;
  }
  const delta = nextText.startsWith(latestText)
    ? nextText.slice(latestText.length)
    : nextText;
  latestText = nextText;
  latestContent = nextContent;
  emit({ type: "message.delta", messageId: activeMessageId, text: delta });
  emit({
    type: "message.snapshot",
    messageId: activeMessageId,
    content: nextContent,
    text: nextText,
    providerHtml,
    phase: "streaming",
  });
}

function scheduleStreamFlush(): void {
  if (streamFlushTimer) return;
  streamFlushTimer = window.setTimeout(() => {
    flushStreamUpdate();
  }, STREAM_FLUSH_MS);
}

function observeGeneration(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    emitAuthIfChanged();
    scheduleCapabilityDetection();
    if (!activeMessageId) return;
    const nextText = getAssistantText();
    const providerHtml = getAssistantHtml();
    const nextContent = getAssistantContent(nextText || latestText, providerHtml);
    if (!nextText && !providerHtml && nextContent.length === 0) return;
    if (providerHtml) {
      pendingProviderHtml = providerHtml;
    }
    if (nextText) {
      pendingSnapshotText = nextText;
    }
    if (nextContent.length > 0) {
      pendingSnapshotContent = nextContent;
    }
    if (nextText && nextText !== latestText) {
      lastMutationAt = Date.now();
    }
    scheduleStreamFlush();
    scheduleCompletionCheck();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  emitAuthIfChanged();
  scheduleCapabilityDetection();
}

function scheduleCompletionCheck(): void {
  if (completionTimer) window.clearTimeout(completionTimer);
  completionTimer = window.setTimeout(() => {
    if (!activeMessageId) return;
    const decision = resolveGenerationCheck({
      text: latestText,
      hasStopButton: hasStopButton(),
      hasStreamingIndicator: hasStreamingIndicator(),
      startedAt: generationStartedAt,
      lastMutationAt,
    });
    if (decision.type === "fail") {
      emit({
        type: "generation.failed",
        code: decision.code,
        recoverable: true,
        phase: decision.phase,
        detail: decision.detail,
      });
      resetActiveGeneration();
      return;
    }
    if (decision.type === "complete") {
      completeGeneration();
      return;
    }
    scheduleCompletionCheck();
  }, 1_250);
}

function completeGeneration(): void {
  if (!activeMessageId) return;
  flushStreamUpdate(true);
  const message: NormalizedMessage = {
    id: activeMessageId,
    conversationId: "__provider_runtime__",
    role: "assistant",
    content: latestContent.length > 0
      ? latestContent
      : getAssistantContent(latestText, getAssistantHtml()),
    providerHtml: getAssistantHtml(),
    status: "completed",
    statusPhase: "completed",
    provider: providerId,
    createdAt: new Date().toISOString(),
  };
  emit({ type: "message.completed", message });
  resetActiveGeneration();
}

function resetActiveGeneration(): void {
  if (streamFlushTimer) {
    window.clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }
  activeMessageId = undefined;
  latestText = "";
  latestContent = [];
  pendingSnapshotText = undefined;
  pendingProviderHtml = undefined;
  pendingSnapshotContent = undefined;
}

function selectComposerContents(element: HTMLElement): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function clearComposer(element: HTMLElement): void {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, "");
  } else {
    selectComposerContents(element);
    document.execCommand("delete");
    element.textContent = "";
  }
}

function dispatchInputEvents(element: HTMLElement, text: string): void {
  element.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    composed: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  }));
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    inputType: "insertText",
    data: text,
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function shouldUseCDPTextInsertion(element: HTMLElement): boolean {
  return definition.submitWithEnter ||
    providerId === "qianwen" ||
    element.isContentEditable ||
    element.getAttribute("contenteditable") === "true";
}

async function setComposerText(element: HTMLElement, text: string): Promise<void> {
  element.focus();
  clearComposer(element);
  await waitForUiSettle();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, text);
    dispatchInputEvents(element, text);
    return;
  }
  selectComposerContents(element);
  if (shouldUseCDPTextInsertion(element)) {
    await ipcRenderer.invoke("provider:insert-text", text);
    await waitForUiSettle();
    const inserted = normalizedConversationText(element).includes(text.slice(0, 20));
    if (!inserted) {
      element.textContent = text;
      dispatchInputEvents(element, text);
    }
  } else if (!document.execCommand("insertText", false, text)) {
    element.textContent = text;
    dispatchInputEvents(element, text);
  }
  dispatchInputEvents(element, text);
}

async function waitForUiSettle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => window.setTimeout(resolve, 80));
}

async function waitForComposer(timeoutMs = 10_000): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composer = firstInRoots(definition.composerSelectors);
    if (composer) return composer;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("Provider composer not found.");
}

async function waitForSubmit(timeoutMs = 5_000): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const submit = firstInRoots(definition.submitSelectors);
    if (submit || definition.submitWithEnter) return submit ?? undefined;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return undefined;
}

async function sentSuccessfully(text: string, baselineUrl: string): Promise<boolean> {
  const snippet = text.trim().slice(0, 80);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const authReason = authInterruptionReason();
    if (authReason) {
      throw new Error(authReason);
    }
    if (hasStopButton()) return true;
    if (location.href !== baselineUrl) return true;
    const assistant = assistantElement();
    if (assistant) {
      const aText = normalizedConversationText(assistant);
      if (aText && aText !== assistantBaseline) return true;
    }
    const root = definition.conversationDocumentSelectors?.length
      ? firstInRoots(definition.conversationDocumentSelectors)
      : undefined;
    if (root && snippet && normalizedConversationText(root).includes(snippet)) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  const hasComposer = Boolean(firstInRoots(definition.composerSelectors));
  const hasSubmit = Boolean(firstInRoots(definition.submitSelectors));
  const assistant = assistantElement();
  const aText = assistant ? normalizedConversationText(assistant).slice(0, 60) : "none";
  throw new Error(
    `Submission detection failed: composer=${hasComposer} submit=${hasSubmit} assistant="${aText}" url=${location.href === baselineUrl ? "same" : "changed"}`,
  );
}

async function submitWithEnter(composer: HTMLElement): Promise<void> {
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
}

async function sendMessage(text: string): Promise<void> {
  emitStatus("checking-auth");
  const state = detectState();
  if (!state.authenticated) throw new Error(state.reason);
  let composer: HTMLElement;
  try {
    composer = await waitForComposer();
  } catch (e) {
    throw new Error(`Composer not found: ${String(e)}`);
  }
  captureConversationBaseline();
  if (text) {
    emitStatus("typing-message");
    try {
      await setComposerText(composer, text);
    } catch (e) {
      throw new Error(`Text entry failed: ${String(e)}`);
    }
  }
  await waitForUiSettle();
  const submit = await waitForSubmit();
  if (!submit && !definition.submitWithEnter) {
    emit({
      type: "adapter.degraded",
      reason: "The provider send button could not be located.",
    });
    throw new Error("Provider send button not found.");
  }
  emitStatus("submitting");
  const baselineUrl = location.href;
  try {
    if (submit) submit.click();
    else await submitWithEnter(composer);
  } catch (e) {
    throw new Error(`Submit action failed: ${String(e)}`);
  }
  activeMessageId = crypto.randomUUID();
  latestText = "";
  latestContent = [];
  lastMutationAt = Date.now();
  generationStartedAt = lastMutationAt;
  emitStatus("waiting-first-token");
  emit({ type: "message.started", messageId: activeMessageId });
  scheduleCompletionCheck();
  sentSuccessfully(text, baselineUrl).then((ok) => {
    if (ok && location.href !== baselineUrl && definition.conversationUrlPattern) {
      const match = definition.conversationUrlPattern.exec(location.href);
      if (match?.[1]) {
        emit({ type: "conversation.changed", externalId: location.href });
      }
    }
  }).catch(() => {});
}

function cancelGeneration(): void {
  const stop = firstInRoots(definition.stopSelectors);
  stop?.click();
  if (activeMessageId) {
    emit({
      type: "generation.failed",
      code: "cancelled_by_user",
      recoverable: true,
      phase: "failed",
      detail: "Generation was cancelled by the user.",
    });
  }
  resetActiveGeneration();
}

function inputMatchesAttachmentMode(
  input: HTMLInputElement,
  attachmentMode: "image" | "document",
): boolean {
  const accept = input.accept.toLowerCase();
  if (!accept.trim()) return true;
  const acceptsImage = /image|png|jpe?g|webp|gif|bmp/.test(accept);
  const acceptsDocument = /pdf|doc|xls|ppt|txt|csv|json|md|markdown|epub|html|yaml|ipynb/.test(accept);
  return attachmentMode === "image"
    ? acceptsImage
    : acceptsDocument || (!acceptsImage && !acceptsDocument);
}

function prepareAttachmentInput(
  attachmentMode: "image" | "document" = "document",
): { ready: boolean; x?: number; y?: number } {
  document.querySelectorAll("[data-aihub-file-input]").forEach((element) =>
    element.removeAttribute("data-aihub-file-input"),
  );
  const input = definition.fileInputSelectors
    .flatMap((selector) => queryAllInRoots<HTMLInputElement>(selector))
    .find((candidate) => inputMatchesAttachmentMode(candidate, attachmentMode));
  if (input) {
    input.setAttribute("data-aihub-file-input", "true");
    return { ready: true };
  }
  const labels = (attachmentMode === "image"
    ? [...definition.attachmentControlLabels, "upload image"]
    : [...definition.attachmentControlLabels, "upload document", "upload file"])
    .map((label) => label.toLowerCase());
  const popupCandidate = queryAllInRoots<HTMLElement>("button,[role='button'],[aria-label],[title]")
    .find((element) => {
      const label = controlLabel(element).toLowerCase();
      return labels.some((candidate) => label.includes(candidate)) && visible(element);
    });
  if (popupCandidate) {
    const rect = popupCandidate.getBoundingClientRect();
    return {
      ready: false,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
  const preferred = definition.attachmentControlSelectors.flatMap((selector) =>
    queryAllInRoots<HTMLElement>(selector)
  );
  const preferredMatch = preferred.find((element) => visible(element));
  if (preferredMatch) {
    const rect = preferredMatch.getBoundingClientRect();
    return {
      ready: false,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
  return { ready: false };
}

async function waitForAttachments(names: string[]): Promise<void> {
  const deadline = performance.now() + 30_000;
  let stable = 0;
  while (performance.now() < deadline) {
    const input = queryAllInRoots<HTMLInputElement>(
      "input[data-aihub-file-input='true'],input[type='file']",
    )[0];
    const selected = Array.from(input?.files ?? []).map((file) => file.name);
    const pageText = document.body.innerText;
    const represented = names.every((name) => selected.includes(name) || pageText.includes(name));
    const busy = queryAllInRoots<HTMLElement>(
      "[aria-busy='true'],[role='progressbar']," +
        "[class*='upload'][class*='loading'],[class*='upload'][class*='progress']",
    ).some((element) => visible(element));
    if (represented && !busy) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  throw new Error("Attachment upload did not finish within 30 seconds.");
}

function configureMode(
  mode: ProviderMode,
  enabled: boolean,
): { available: boolean; enabled: boolean; x?: number; y?: number; transient?: boolean } {
  const modeDefinition = definition.modeDefinitions.find(
    (candidate) => candidate.mode === mode,
  );
  if (!modeDefinition) return { available: false, enabled: false };
  const state = currentModeState(modeDefinition);
  const opener = state.opener;
  const current = state.enabled;
  if (!state.available) return { available: false, enabled: false };
  if (current === enabled) return { available: true, enabled: current };
  const target = findControl(
    enabled ? modeDefinition.matchLabels : modeDefinition.disabledLabels ?? [],
    opener,
  ) ?? opener;
  if (!target) return { available: true, enabled: current };
  const rect = target.getBoundingClientRect();
  const transient = enabled &&
    Boolean(opener) &&
    target !== opener &&
    (modeDefinition.disabledLabels?.length ?? 0) === 0;
  return {
    available: true,
    enabled: current,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    transient,
  };
}

function modelAction(model?: string): { available: boolean; selected: boolean; x?: number; y?: number } {
  const control = modelControlElement();
  if (!control) return { available: false, selected: false };
  if (control instanceof HTMLSelectElement) {
    if (!model) return { available: true, selected: true };
    const option = Array.from(control.options).find((item) =>
      item.value === model || item.textContent?.trim() === model
    );
    if (!option) return { available: true, selected: false };
    control.value = option.value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return { available: true, selected: true };
  }
  if (model && controlLabel(control).includes(model)) {
    return { available: true, selected: true };
  }
  const option = model
    ? modelOptionElements().find((item) => {
        const label = modelOptionLabel(item);
        const id = item.getAttribute("data-value") ?? item.getAttribute("value") ?? label;
        return id === model || label === model;
      })
    : undefined;
  const target = option ?? control;
  const rect = target.getBoundingClientRect();
  return {
    available: true,
    selected: false,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

ipcRenderer.on("provider:command", async (_event, command: ProviderCommand) => {
  try {
    let value: unknown;
    if (command.type === "detect-state") {
      value = detectState();
    } else if (command.type === "send-message") {
      const text = command.payload?.text?.trim();
      await sendMessage(text ?? "");
    } else if (command.type === "cancel-generation") {
      cancelGeneration();
    } else if (command.type === "prepare-attachments") {
      value = prepareAttachmentInput(command.payload?.attachmentMode);
    } else if (command.type === "wait-attachments") {
      await waitForAttachments(command.payload?.names ?? []);
    } else if (command.type === "configure-mode") {
      if (!command.payload?.mode) throw new Error("Provider mode is missing.");
      value = configureMode(command.payload.mode, command.payload.enabled ?? false);
    } else if (command.type === "discover-models") {
      value = modelAction();
    } else if (command.type === "configure-model") {
      if (!command.payload?.model) throw new Error("Provider model is missing.");
      value = modelAction(command.payload.model);
    } else {
      throw new Error("Unsupported provider command.");
    }
    ipcRenderer.send(`provider:response:${command.requestId}`, {
      ok: true,
      value,
    });
  } catch (error) {
    ipcRenderer.send(`provider:response:${command.requestId}`, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    observeGeneration();
    injectHideButton();
  }, { once: true });
} else {
  observeGeneration();
  injectHideButton();
}

function injectHideButton(): void {
  if (document.getElementById("aihub-hide-provider")) return;
  const host = document.createElement("div");
  host.id = "aihub-hide-provider";
  host.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:2147483647;display:flex;gap:4px;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    button{all:initial;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:16px;cursor:pointer;border:none;opacity:.4;transition:opacity .15s,background .15s}
    button:hover{opacity:1;background:rgba(0,0,0,.7)}
  </style>
  <button title="Hide provider">&#x25C0;</button>
  <button title="Debug DOM">&#x1F41B;</button>`;
  const buttons = shadow.querySelectorAll("button");
  const hideBtn = buttons[0]!;
  const debugBtn = buttons[1]!;
  hideBtn.addEventListener("click", () => {
    void ipcRenderer.invoke("provider:hide-self");
  });
  debugBtn.addEventListener("click", () => {
    const main = document.querySelector("main") ?? document.body;
    const candidates = main.querySelectorAll(
      "[class*='message'],[class*='answer'],[class*='response'],[class*='bot'],[class*='assistant'],[class*='markdown'],[class*='chat'],[class*='content'],[role='article'],[role='log'],[data-message-id],[data-copy-telemetry],[data-container-type],[data-testid*='assistant'],[data-role='assistant']",
    );
    const info: string[] = [];
    info.push(`URL: ${location.href}`);
    info.push(`main children: ${main.children.length}`);
    info.push(`candidates found: ${candidates.length}`);
    for (const el of Array.from(candidates).slice(0, 50)) {
      const e = el as HTMLElement;
      const tag = e.tagName.toLowerCase();
      const cls = e.className ? `.${String(e.className).split(/\s+/).slice(0, 5).join(".")}` : "";
      const role = e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : "";
      const data = Array.from(e.attributes)
        .filter((a) => a.name.startsWith("data-"))
        .map((a) => `[${a.name}=${JSON.stringify(a.value)}]`)
        .join("");
      const text = plainTextWithShadow(e).slice(0, 100);
      info.push(`${tag}${cls}${role}${data} → "${text}"`);
    }
    info.push(`\n--- assistantElement() result ---`);
    const assistant = pickAssistantElement(
      providerId,
      definition.assistantMessageSelectors,
      (selector) => queryAllInRoots<HTMLElement>(selector),
    );
    if (assistant) {
      const aText = normalizedConversationText(assistant);
      info.push(`found: ${assistant.tagName}.${String(assistant.className).split(/\s+/)[0]}`);
      info.push(`text (${aText.length} chars): "${aText.slice(0, 200)}"`);
      info.push(`assistantBaseline: "${assistantBaseline.slice(0, 100)}"`);
      info.push(`latestText: "${latestText.slice(0, 100)}"`);
      info.push(`activeMessageId: ${activeMessageId ?? "none"}`);
    } else {
      info.push(`NOT FOUND — no element matched any selector`);
    }
    const result = info.join("\n");
    void ipcRenderer.invoke("provider:debug-dump", result);
  });
  document.documentElement.appendChild(host);
}
