import { ipcRenderer } from "electron";
import {
  firstMatch,
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
} from "@aihub/core";

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
let lastMutationAt = 0;
let generationStartedAt = 0;
let completionTimer: number | undefined;
let lastAuthState: boolean | undefined;
let conversationBaseline = "";
let assistantBaseline = "";
let lastCapabilities = "";
let capabilityTimer: number | undefined;

function emit(event: ProviderEvent): void {
  ipcRenderer.send("provider:event", event);
}

function detectState(): ProviderState {
  const composer = firstMatch(document, definition.composerSelectors);
  const loginMarker = firstMatch(document, definition.loginMarkers);
  const authBlocker = (definition.authBlockerSelectors ?? [])
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .find((candidate): candidate is HTMLElement =>
      candidate !== null && visible(candidate)
    );
  // A usable composer is the strongest cross-provider signal that the user can
  // chat. Many provider shells keep hidden login buttons or phone inputs in
  // the DOM after authentication, so login markers must not override it.
  const authenticated = Boolean(composer) && !authBlocker;
  return {
    authenticated,
    ready: authenticated,
    degraded: false,
    reason: authenticated
      ? undefined
      : authBlocker
        ? "Login or provider verification is blocking the composer."
        : loginMarker
        ? "Login or provider verification is required."
        : "The provider composer is not ready yet.",
  };
}

function emitAuthIfChanged(): void {
  const authenticated = detectState().authenticated;
  if (authenticated !== lastAuthState) {
    lastAuthState = authenticated;
    emit({ type: "auth.changed", authenticated });
  }
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function findControl(
  labels: string[],
  excluded?: HTMLElement,
): HTMLElement | undefined {
  const normalized = labels.map((label) => label.toLowerCase());
  return Array.from(document.querySelectorAll<HTMLElement>(
    "button,[role='button'],[role='checkbox'],[role='switch']," +
    "[role='menuitem'],[aria-pressed],[data-state]," +
    "[class*='mode'],[class*='tool'],[class*='menu']",
  )).find((element) => {
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
  return modeDefinition
    ? findControl(modeDefinition.matchLabels)
    : undefined;
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
  return definition.modelControlSelectors
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .find((candidate): candidate is HTMLElement =>
      candidate !== null && visible(candidate)
    );
}

function modelOptionElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    "option,[role='option'],[role='menuitem']," +
    "[data-testid*='model-option'],[class*='model-option']," +
    ".model-item-content,[role='dialog'] .cursor-pointer",
  )).filter((element) =>
    element instanceof HTMLOptionElement || visible(element)
  );
}

function modelOptionLabel(element: HTMLElement): string {
  return element.querySelector<HTMLElement>(".name,.truncate")
    ?.textContent?.trim() || controlLabel(element);
}

function detectCapabilities(): ProviderEvent & {
  type: "capabilities.changed";
} {
  const fileInput = definition.fileInputSelectors
    .map((selector) => document.querySelector<HTMLInputElement>(selector))
    .find((candidate): candidate is HTMLInputElement => Boolean(candidate));
  const modelControl = modelControlElement();
  const models = modelControl instanceof HTMLSelectElement
    ? Array.from(modelControl.options)
      .filter((option) => option.value || option.textContent?.trim())
      .map((option) => ({
        id: option.value || option.textContent!.trim(),
        label: option.textContent?.trim() || option.value,
      }))
    : modelOptionElements().map((option) => {
        const label = modelOptionLabel(option);
        return {
          id: option.getAttribute("data-value") ??
            option.getAttribute("value") ??
            label,
          label,
        };
      }).filter((option) => option.label);
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
      attachments: fileInput
        ? attachmentKinds(fileInput.accept)
        : [],
      modes: definition.modeDefinitions.flatMap((item) => {
        const state = currentModeState(item);
        return state.available
          ? [{
              mode: item.mode,
              label: item.label,
              enabled: state.enabled,
            }]
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

function getAssistantText(): string {
  for (const selector of definition.assistantMessageSelectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    const last = elements.item(elements.length - 1);
    const text = last?.innerText?.trim();
    if (text && text !== assistantBaseline) return text;
  }
  if (definition.conversationDocumentSelectors?.length) {
    const documentRoot = firstMatch(
      document,
      definition.conversationDocumentSelectors,
    );
    if (documentRoot) {
      const text = normalizedConversationText(documentRoot);
      if (conversationBaseline) {
        return cleanConversationDelta(conversationTextDelta(
          conversationBaseline,
          text,
        ));
      }
    }
  }
  return "";
}

function getAssistantHtml(): string | undefined {
  const styleProperties = [
    "display",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "color",
    "text-align",
    "text-decoration-line",
    "text-decoration-color",
    "white-space",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "list-style-type",
    "list-style-position",
    "background-color",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-radius",
    "max-width",
    "overflow-wrap",
  ] as const;
  for (const selector of definition.assistantMessageSelectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    const last = elements.item(elements.length - 1);
    if (!last) continue;
    const clone = last.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(
      "button,nav,footer,header,script,style,iframe,form,input,textarea," +
      "select,[role='button'],[contenteditable='true']",
    ).forEach((element) => element.remove());
    clone.querySelectorAll<HTMLElement>("*").forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc") {
          element.removeAttribute(attribute.name);
        }
      }
      for (const attributeName of ["src", "href", "poster"] as const) {
        const value = element.getAttribute(attributeName);
        if (!value) continue;
        try {
          element.setAttribute(attributeName, new URL(value, location.href).href);
        } catch {
          element.removeAttribute(attributeName);
        }
      }
    });
    const sourceElements = [last, ...Array.from(last.querySelectorAll<HTMLElement>("*"))];
    const cloneElements = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
    for (const [index, source] of sourceElements.entries()) {
      const target = cloneElements[index];
      if (!target) continue;
      const computed = getComputedStyle(source);
      const style = styleProperties
        .map((name) => `${name}:${computed.getPropertyValue(name)}`)
        .filter((value) =>
          !value.endsWith(":") &&
          !value.endsWith(":none") &&
          !value.endsWith(":normal")
        )
        .join(";");
      if (style) target.setAttribute("style", style);
    }
    const html = clone.innerHTML.trim();
    if (html) return html;
  }
  return undefined;
}

function conversationTextDelta(before: string, after: string): string {
  let prefixLength = 0;
  const limit = Math.min(before.length, after.length);
  while (
    prefixLength < limit &&
    before.charCodeAt(prefixLength) === after.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }
  return after.slice(prefixLength).trim();
}

function normalizedConversationText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      [
        "#input-engine-container",
        "button",
        "svg",
        "[role='button']",
        "[aria-hidden='true']",
        "[class*='suggest']",
        "[class*='recommend']",
      ].join(","),
    )
    .forEach((element) => element.remove());
  return (clone.innerText || clone.textContent || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanConversationDelta(text: string): string {
  const ignored = [
    "AI 生成可能有误 请核实",
    "AI 生成可能有误，请核实",
    "开启自动播报",
    "朗读",
  ];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !ignored.includes(line))
    .join("\n")
    .trim();
}

function captureConversationBaseline(): void {
  assistantBaseline = "";
  for (const selector of definition.assistantMessageSelectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    const text = elements.item(elements.length - 1)?.innerText?.trim();
    if (text) {
      assistantBaseline = text;
      break;
    }
  }
  if (!definition.conversationDocumentSelectors?.length) {
    conversationBaseline = "";
    return;
  }
  const root = firstMatch(document, definition.conversationDocumentSelectors);
  conversationBaseline = root ? normalizedConversationText(root) : "";
}

function hasStopButton(): boolean {
  return Boolean(firstMatch(document, definition.stopSelectors));
}

function observeGeneration(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    emitAuthIfChanged();
    scheduleCapabilityDetection();
    if (!activeMessageId) return;
    const nextText = getAssistantText();
    const providerHtml = getAssistantHtml();
    if (!nextText && !providerHtml) return;
    if (!nextText || nextText === latestText) {
      if (providerHtml) {
        emit({
          type: "message.snapshot",
          messageId: activeMessageId,
          text: latestText,
          providerHtml,
        });
        scheduleCompletionCheck();
      }
      return;
    }

    let delta: string;
    if (nextText.startsWith(latestText)) {
      delta = nextText.slice(latestText.length);
    } else {
      delta = nextText;
      latestText = "";
    }
    latestText = nextText;
    lastMutationAt = Date.now();
    emit({ type: "message.delta", messageId: activeMessageId, text: delta });
    emit({
      type: "message.snapshot",
      messageId: activeMessageId,
      text: nextText,
      providerHtml,
    });
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
    if (
      activeMessageId &&
      !latestText &&
      !hasStopButton() &&
      Date.now() - generationStartedAt >= 45_000
    ) {
      emit({
        type: "generation.failed",
        code: "provider_response_not_detected",
        recoverable: true,
      });
      activeMessageId = undefined;
      return;
    }
    if (
      activeMessageId &&
      latestText &&
      !hasStopButton() &&
      Date.now() - lastMutationAt >= 1_200
    ) {
      completeGeneration();
    } else if (activeMessageId) {
      scheduleCompletionCheck();
    }
  }, 1_250);
}

function completeGeneration(): void {
  if (!activeMessageId) return;
  const message: NormalizedMessage = {
    id: activeMessageId,
    conversationId: "__provider_runtime__",
    role: "assistant",
    content: [{ type: "text", text: latestText }],
    providerHtml: getAssistantHtml(),
    status: "completed",
    provider: providerId,
    createdAt: new Date().toISOString(),
  };
  emit({ type: "message.completed", message });
  activeMessageId = undefined;
  latestText = "";
}

function setComposerText(element: HTMLElement, text: string): void {
  element.focus();
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, text);
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) element.textContent = text;
  }
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text,
    }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function submitWithEnter(composer: HTMLElement): void {
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    composer.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  }
}

async function sendMessage(text: string): Promise<void> {
  const state = detectState();
  if (!state.authenticated) throw new Error(state.reason);
  const composer = firstMatch(document, definition.composerSelectors);
  if (!composer) {
    emit({
      type: "adapter.degraded",
      reason: "The provider composer could not be located.",
    });
    throw new Error("Provider composer not found.");
  }

  captureConversationBaseline();
  if (text) setComposerText(composer, text);
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  const submit = firstMatch(document, definition.submitSelectors);
  if (!submit && !definition.submitWithEnter) {
    emit({
      type: "adapter.degraded",
      reason: "The provider send button could not be located.",
    });
    throw new Error("Provider send button not found.");
  }

  activeMessageId = crypto.randomUUID();
  latestText = "";
  lastMutationAt = Date.now();
  generationStartedAt = lastMutationAt;
  emit({ type: "message.started", messageId: activeMessageId });
  if (submit) submit.click();
  else submitWithEnter(composer);
  scheduleCompletionCheck();
}

function cancelGeneration(): void {
  const stop = firstMatch(document, definition.stopSelectors);
  stop?.click();
  if (activeMessageId) {
    emit({
      type: "generation.failed",
      code: "cancelled_by_user",
      recoverable: true,
    });
  }
  activeMessageId = undefined;
  latestText = "";
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
): {
  ready: boolean;
  x?: number;
  y?: number;
} {
  document.querySelectorAll("[data-aihub-file-input]").forEach((element) =>
    element.removeAttribute("data-aihub-file-input"),
  );
  const input = definition.fileInputSelectors
    .map((selector) => document.querySelector<HTMLInputElement>(selector))
    .find((candidate): candidate is HTMLInputElement => Boolean(candidate));
  if (input && inputMatchesAttachmentMode(input, attachmentMode)) {
    input.setAttribute("data-aihub-file-input", "true");
    return { ready: true };
  }
  const labels = (attachmentMode === "image"
    ? [...definition.attachmentControlLabels, "上传图片", "添加图片", "upload image"]
    : [...definition.attachmentControlLabels, "上传文档", "上传文件", "upload document", "upload file"]
  ).map(
    (label) => label.toLowerCase(),
  );
  const popupCandidate = Array.from(document.querySelectorAll<HTMLElement>(
    "button,[role='button'],[aria-label],[title]",
  )).find((element) => {
    const label = (
      element.getAttribute("aria-label") ??
      element.getAttribute("title") ??
      element.innerText ??
      ""
    ).trim();
    const rect = element.getBoundingClientRect();
    const normalized = label.toLowerCase();
    return labels.some((candidate) => normalized.includes(candidate)) &&
      rect.width > 2 && rect.height > 2;
  });
  if (popupCandidate) {
    const rect = popupCandidate.getBoundingClientRect();
    return {
      ready: false,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
  const preferred = definition.attachmentControlSelectors.flatMap(
    (selector) => Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ),
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
    const input = document.querySelector<HTMLInputElement>(
      "input[data-aihub-file-input='true'],input[type='file']",
    );
    const selected = Array.from(input?.files ?? []).map((file) => file.name);
    const pageText = document.body.innerText;
    const represented = names.every((name) =>
      selected.includes(name) || pageText.includes(name),
    );
    const busy = Array.from(document.querySelectorAll<HTMLElement>(
      "[aria-busy='true'],[role='progressbar']," +
      "[class*='upload'][class*='loading'],[class*='upload'][class*='progress']",
    )).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    });
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

function controlLabel(element: HTMLElement): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.innerText ??
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

function configureMode(
  mode: ProviderMode,
  enabled: boolean,
): {
  available: boolean;
  enabled: boolean;
  x?: number;
  y?: number;
  transient?: boolean;
} {
  const modeDefinition = definition.modeDefinitions.find(
    (candidate) => candidate.mode === mode,
  );
  if (!modeDefinition) return { available: false, enabled: false };
  const state = currentModeState(modeDefinition);
  const opener = state.opener;
  const current = state.enabled;
  if (!state.available) {
    return { available: false, enabled: false };
  }
  if (current === enabled) return { available: true, enabled: current };
  const target = findControl(
    enabled
      ? modeDefinition.matchLabels
      : modeDefinition.disabledLabels ?? [],
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

function modelAction(model?: string): {
  available: boolean;
  selected: boolean;
  x?: number;
  y?: number;
} {
  const control = modelControlElement();
  if (!control) return { available: false, selected: false };
  if (control instanceof HTMLSelectElement) {
    if (!model) return { available: true, selected: true };
    const option = Array.from(control.options).find((item) =>
      item.value === model || item.textContent.trim() === model
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
        const id = item.getAttribute("data-value") ??
          item.getAttribute("value") ??
          label;
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

ipcRenderer.on(
  "provider:command",
  async (_event, command: ProviderCommand) => {
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
        value = configureMode(
          command.payload.mode,
          command.payload.enabled ?? false,
        );
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
  },
);

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", observeGeneration, { once: true });
} else {
  observeGeneration();
}
