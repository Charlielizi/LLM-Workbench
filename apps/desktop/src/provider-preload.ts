import { ipcRenderer } from "electron";
import {
  createWebsiteAdapter,
  providerDefinitions,
  type ProviderDefinition,
  type AssistantBinding,
  type ConversationAnchor,
  type WebsiteAdapter,
} from "@aihub/adapters";
import {
  currentWebConversationSyncResultSchema,
  providerTransportEventSchema,
  type ProviderInteractionTarget,
  type ProviderSubmitEvidence,
  type ProviderTextVerification,
  type ProviderTransportEvent,
  type AttachmentKind,
  type NormalizedMessage,
  type ProviderDebugSnapshot,
  type ProviderEvent,
  type ProviderId,
  type ProviderMode,
  type ProviderState,
  type ProviderSendPhase,
  type WebsiteConversationRef,
  type WebsiteConversationListSnapshot,
  type WebsiteConversationSnapshot,
} from "@aihub/core";
import {
  describeCompletionSignals,
  resolveGenerationCheck,
  type CompletionSignals,
} from "./provider-generation-policy";

interface ProviderCommand {
  requestId: string;
  type:
    | "detect-state"
    | "send-message"
    | "prepare-trusted-send"
    | "verify-trusted-input"
    | "arm-trusted-send"
    | "confirm-trusted-submit"
    | "prepare-deepseek-trusted-retry"
    | "trusted-submit-target"
    | "start-trusted-generation"
    | "abort-trusted-send"
    | "prepare-trusted-cancel"
    | "finalize-trusted-cancel"
    | "prepare-trusted-external-retry"
    | "compose-message"
    | "cancel-generation"
    | "prepare-attachments"
    | "wait-attachments"
    | "configure-mode"
    | "discover-models"
    | "configure-model"
    | "capture-anchor"
    | "sync-latest-response"
    | "list-web-conversations"
    | "extract-current-conversation"
    | "get-debug-snapshot"
    | "set-clean-mode"
    | "init-network-monitor"
    | "check-completion"
    | "dispose";
  payload?: {
    text?: string;
    names?: string[];
    modes?: string[];
    model?: string;
    attachmentMode?: "image" | "document";
    mode?: ProviderMode;
    enabled?: boolean;
    cleanMode?: boolean;
    flaky?: boolean;
  };
}

interface SettledAssistantResponse {
  url: string;
  text: string;
  content: NormalizedMessage["content"];
  providerHtml?: string;
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
const websiteAdapter: WebsiteAdapter = createWebsiteAdapter(providerId);
let observer: MutationObserver | undefined;
let pollingTimer: number | undefined;
let conversationDirtyTimer: number | undefined;
let lastConversationDirtySignature = "";
let activeMessageId: string | undefined;
let activeAnchor: ConversationAnchor | undefined;
let boundAssistant: AssistantBinding | undefined;
let latestText = "";
let latestContent: NormalizedMessage["content"] = [];
let lastMutationAt = 0;
let generationStartedAt = 0;
let lastCompletionDecision = "not-started";
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
let networkActiveCount = 0;
let networkIdle = true;
let lastNetworkUrl = "";
let completionRequestSeen = false;
let networkMonitorInitialized = false;
let lastTransportEvent: ProviderTransportEvent | undefined;
let networkIdleTimer: number | undefined;
const activeTransportRequests = new Set<string>();
let cleanModeEnabled = false;
let cleanModeStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
let originalAttachShadow: typeof Element.prototype.attachShadow | undefined;
let completionDetectingEmitted = false;
let assistantBindingPhaseEmitted = false;
let lastSettledSnapshot: ProviderDebugSnapshot | undefined;
let lastSettledAssistant: SettledAssistantResponse | undefined;
let activePromptText = "";
let trustedBaselineUrl = "";
let trustedTransactionArmed = false;
let trustedTransportSeen = false;
let trustedSubmissionConfirmed = false;
let trustedRetryUsed = false;
let trustedExternalRetry = false;
let lastHistoryScanRounds = 0;
let lastHistoryFallbackReason: string | undefined;

const STREAM_FLUSH_MS = 80;
const POLLING_INTERVAL_MS = 500;
const DEFAULT_SUBMIT_CONFIRM_TIMEOUT_MS = 15_000;
const LEGACY_NETWORK_EVENT_TYPE = "aihub-provider-network";

async function listWebConversations(): Promise<WebsiteConversationListSnapshot> {
  const values = new Map<string, WebsiteConversationRef>();
  const scroll = websiteAdapter.getConversationListScrollContainer();
  const originalScrollTop = scroll?.scrollTop ?? 0;
  let stableRounds = 0;
  lastHistoryScanRounds = 0;
  try {
    for (let round = 0; round < 30 && values.size < 500; round += 1) {
      lastHistoryScanRounds = round + 1;
      const before = values.size;
      for (const ref of websiteAdapter.listVisibleConversations()) {
        values.set(ref.url, ref);
        if (values.size >= 500) break;
      }
      stableRounds = values.size === before ? stableRounds + 1 : 0;
      if (!scroll || stableRounds >= 3) break;
      const next = Math.min(
        scroll.scrollHeight - scroll.clientHeight,
        scroll.scrollTop + Math.max(200, scroll.clientHeight * 0.8),
      );
      if (next <= scroll.scrollTop) break;
      scroll.scrollTop = next;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  } finally {
    if (scroll) {
      scroll.scrollTop = originalScrollTop;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }
  lastHistoryFallbackReason = values.size === 0 ? "no-conversation-links" : undefined;
  return {
    conversations: Array.from(values.values()).slice(0, 500),
    scanRounds: lastHistoryScanRounds,
    partial:
      values.size >= 500 ||
      lastHistoryScanRounds >= 30 ||
      Boolean(lastHistoryFallbackReason),
    fallbackReason: lastHistoryFallbackReason,
  };
}
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

function emitAssistantBindingPhase(detail: string): void {
  if (!activeMessageId || assistantBindingPhaseEmitted) return;
  assistantBindingPhaseEmitted = true;
  emitStatus("binding-assistant", detail);
}

function emitGenerationFailure(
  code: string,
  phase: ProviderSendPhase,
  detail: string,
  recoverable = true,
): void {
  lastCompletionDecision = [
    "fail",
    `code=${code}`,
    `phase=${phase}`,
  ].join(" ");
  lastSettledSnapshot = buildDebugSnapshot();
  emit({ type: "provider.debug-snapshot", snapshot: lastSettledSnapshot });
  emit({
    type: "generation.failed",
    messageId: activeMessageId,
    code,
    recoverable,
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

function stableTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeTrustedText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u200b/g, "");
}

function composerText(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return normalizeTrustedText(element.value);
  }
  return normalizeTrustedText(element.innerText ?? element.textContent ?? "");
}

function interactionElementType(
  element: HTMLElement,
): ProviderInteractionTarget["elementType"] {
  if (element instanceof HTMLInputElement) return "input";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLButtonElement) return "button";
  if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
    return "contenteditable";
  }
  return "other";
}

function interactionTarget(
  element: HTMLElement,
  action: ProviderInteractionTarget["action"],
  inputMethod: ProviderInteractionTarget["inputMethod"],
): ProviderInteractionTarget {
  if (!visible(element)) {
    throw new Error(`Provider ${action} target is not visible.`);
  }
  const rect = element.getBoundingClientRect();
  const label = [
    element.tagName.toLowerCase(),
    element.getAttribute("role") ?? "",
    element.getAttribute("type") ?? "",
    element.getAttribute("data-testid") ?? "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("placeholder") ?? "",
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join("|");
  return {
    action,
    inputMethod,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    elementType: interactionElementType(element),
    fingerprint: stableTextHash(label),
  };
}

function detectState(): ProviderState {
  const composer = firstInRoots(definition.composerSelectors);
  const submit = firstInRoots(definition.submitSelectors);
  const loginMarker = firstInRoots(definition.loginMarkers);
  const authBlocker = (definition.authBlockerSelectors ?? [])
    .flatMap((selector) => queryAllInRoots<HTMLElement>(selector))
    .find((candidate) => visible(candidate));
  const teaserComposer = Boolean(composer) && !submit && Boolean(loginMarker);
  const authReason = websiteAdapter.detectAuthInterruption();
  const authenticated = Boolean(composer) && !authBlocker && !teaserComposer;
  return {
    authenticated,
    ready: authenticated,
    degraded: false,
    reason: authenticated
      ? undefined
      : authReason
        ?? (authBlocker
          ? "Login or provider verification is blocking the composer."
          : teaserComposer
            ? "Login or provider verification is required before sending."
            : loginMarker
              ? "Login or provider verification is required."
              : "The provider composer is not ready yet."),
  };
}

async function waitForReadyState(timeoutMs = 10_000): Promise<ProviderState> {
  const deadline = Date.now() + timeoutMs;
  let state = detectState();
  const startedNotReady = !state.authenticated;
  let stableReadySince = 0;
  while (
    Date.now() < deadline
  ) {
    if (state.authenticated) {
      if (!startedNotReady) return state;
      if (networkIdle && networkActiveCount === 0) {
        stableReadySince ||= Date.now();
        if (Date.now() - stableReadySince >= 500) return state;
      } else {
        stableReadySince = 0;
      }
    } else if (state.reason !== "The provider composer is not ready yet.") {
      return state;
    } else {
      stableReadySince = 0;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    state = detectState();
  }
  return state;
}

function authInterruptionReason(): string | undefined {
  const adapterReason = websiteAdapter.detectAuthInterruption();
  if (adapterReason) {
    return adapterReason;
  }
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
): {
  available: boolean;
  enabled: boolean;
  opener?: HTMLElement;
  control?: HTMLElement;
} {
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
    control: directControl,
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
  if (boundAssistant?.element.isConnected) {
    return boundAssistant.element;
  }
  if (activeAnchor) {
    const next = websiteAdapter.findAssistantAfterAnchor(activeAnchor);
    if (next) {
      const candidateText = normalizedConversationText(next.element);
      if (activePromptText && candidateText.trim() === activePromptText.trim()) {
        activeAnchor = websiteAdapter.captureAnchor();
        return undefined;
      }
      boundAssistant = next;
      if (activeMessageId) {
        emit({
          type: "message.assistant-bound",
          messageId: activeMessageId,
          detail: next.detail,
        });
      }
      return next.element;
    }
    if (activeMessageId) return undefined;
  }
  const fallback = websiteAdapter.fallbackAssistant();
  if (fallback) {
    boundAssistant = fallback;
    return fallback.element;
  }
  return undefined;
}

function normalizedConversationText(root: HTMLElement): string {
  return websiteAdapter.extractText(root);
}

function getAssistantText(): string {
  const selected = assistantElement();
  if (!selected) return "";
  const assistantText = selected ? normalizedConversationText(selected) : "";
  if (!assistantText) return "";
  let conversationDelta = "";
  if (definition.conversationDocumentSelectors?.length) {
    const documentRoot = firstInRoots(definition.conversationDocumentSelectors);
    if (documentRoot) {
      const fullText = normalizedConversationText(documentRoot);
      if (conversationBaseline) {
        conversationDelta = cleanConversationDelta(
          conversationTextDelta(conversationBaseline, fullText),
        );
        const normalizedPrompt = cleanConversationDelta(activePromptText);
        if (normalizedPrompt && conversationDelta.startsWith(normalizedPrompt)) {
          conversationDelta = conversationDelta.slice(normalizedPrompt.length).trim();
        }
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
  return websiteAdapter.extractHtml(source);
}

function getAssistantContent(
  text: string,
  providerHtml?: string,
): NormalizedMessage["content"] {
  return websiteAdapter.extractContentBlocks(
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
  activeAnchor = websiteAdapter.captureAnchor();
  boundAssistant = undefined;
  emit({
    type: "message.anchor-captured",
    messageId: activeMessageId,
    detail: `${activeAnchor.elementSignature}:${activeAnchor.sequence}`,
  });
  const assistant = websiteAdapter.fallbackAssistant()?.element;
  assistantBaseline = assistant ? normalizedConversationText(assistant) : "";
  if (!definition.conversationDocumentSelectors?.length) {
    conversationBaseline = "";
    return;
  }
  const root = firstInRoots(definition.conversationDocumentSelectors);
  conversationBaseline = root ? normalizedConversationText(root) : "";
}

function hasStopButton(): boolean {
  return websiteAdapter.isGenerating() || Boolean(firstInRoots(definition.stopSelectors));
}

function recoverableBlockerReason(): string | undefined {
  const configured = (definition.authBlockerSelectors ?? [])
    .flatMap((selector) => queryAllInRoots<HTMLElement>(selector))
    .find((candidate) => visible(candidate));
  if (configured) {
    return "Login or provider verification is blocking the provider page.";
  }
  const genericBlockers = queryAllInRoots<HTMLElement>(
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
    const text = normalizedConversationText(candidate);
    if (!text) continue;
    if (/验证码|captcha/i.test(text)) return text;
    if (/登录|登陆|login|sign in/i.test(text)) return text;
    if (/验证|人机|安全|verify|verification|human|security/i.test(text)) return text;
    if (/限流|频繁|限制|rate limit|too many/i.test(text)) return text;
    if (/出错|错误|失败|重试|稍后|error|failed|try again/i.test(text)) return text;
  }
  return undefined;
}

function hasStreamingIndicator(): boolean {
  const root = assistantElement() ?? null;
  return websiteAdapter.hasStreamingIndicator(root);
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

function collectGenerationUpdate(): void {
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
}

function observeGeneration(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    collectGenerationUpdate();
    scheduleConversationDirty();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  if (!pollingTimer) {
    pollingTimer = window.setInterval(() => {
      collectGenerationUpdate();
    }, POLLING_INTERVAL_MS);
  }
  emitAuthIfChanged();
  scheduleCapabilityDetection();
}

function scheduleConversationDirty(): void {
  if (conversationDirtyTimer) window.clearTimeout(conversationDirtyTimer);
  conversationDirtyTimer = window.setTimeout(() => {
    conversationDirtyTimer = undefined;
    if (activeMessageId) return;
    const conversation = websiteAdapter.getCurrentConversation();
    if (!conversation) return;
    const anchor = websiteAdapter.captureAnchor();
    const signature = [
      conversation.url,
      anchor.sequence,
      anchor.elementSignature,
      anchor.textSignature,
    ].join("|");
    if (signature === lastConversationDirtySignature) return;
    lastConversationDirtySignature = signature;
    emit({ type: "conversation.dirty", externalId: conversation.url });
  }, 1_200);
}

function scheduleCompletionCheck(): void {
  if (completionTimer) return;
  completionTimer = window.setTimeout(() => {
    completionTimer = undefined;
    runCompletionCheck();
  }, 1_250);
}

function currentCompletionSignals(): CompletionSignals {
  const blockerReason = websiteAdapter.findRecoverableBlocker();
  const liveText = getAssistantText() || latestText;
  return {
    text: liveText,
    hasStopButton: hasStopButton(),
    hasStreamingIndicator: hasStreamingIndicator(),
    networkIdle,
    hasRecoverableBlocker: Boolean(blockerReason),
    recoverableBlockerReason: blockerReason,
    startedAt: generationStartedAt,
    lastMutationAt,
    firstTokenTimeoutMs: websiteAdapter.getFirstTokenTimeoutMs(),
    stableThresholdMs: websiteAdapter.getCompletionStableThresholdMs(),
    stallTimeoutMs: 300_000,
    totalTimeoutMs: 600_000,
  };
}

function runCompletionCheck(): void {
  if (!activeMessageId) return;
  const signals = currentCompletionSignals();
  const decision = resolveGenerationCheck(signals);
  lastCompletionDecision = describeCompletionSignals(decision, signals);
  if (decision.type === "fail") {
    emitDebugSnapshot();
    emit({
      type: "generation.failed",
      messageId: activeMessageId,
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
  if (
    !completionDetectingEmitted &&
    signals.text &&
    !signals.hasStopButton &&
    !signals.hasStreamingIndicator
  ) {
    completionDetectingEmitted = true;
    emitStatus(
      "detecting-completion",
      signals.networkIdle === false
        ? "Assistant text is visible; waiting for provider network idle."
        : "Assistant text is visible; waiting for it to stabilize.",
    );
  }
  scheduleCompletionCheck();
}

function completeGeneration(): void {
  if (!activeMessageId) return;
  flushStreamUpdate(true);
  lastCompletionDecision = "complete";
  lastSettledSnapshot = buildDebugSnapshot();
  const providerHtml = getAssistantHtml();
  const content = latestContent.length > 0
    ? latestContent
    : getAssistantContent(latestText, providerHtml);
  const message: NormalizedMessage = {
    id: activeMessageId,
    conversationId: "__provider_runtime__",
    role: "assistant",
    content,
    providerHtml,
    status: "completed",
    statusPhase: "completed",
    provider: providerId,
    createdAt: new Date().toISOString(),
  };
  lastSettledAssistant = {
    url: location.href,
    text: latestText,
    content,
    providerHtml,
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
  completionRequestSeen = false;
  activePromptText = "";
  trustedBaselineUrl = "";
  trustedTransactionArmed = false;
  trustedTransportSeen = false;
  trustedSubmissionConfirmed = false;
  trustedRetryUsed = false;
  trustedExternalRetry = false;
  activeAnchor = undefined;
  boundAssistant = undefined;
  latestText = "";
  latestContent = [];
  lastCompletionDecision = "not-started";
  completionDetectingEmitted = false;
  assistantBindingPhaseEmitted = false;
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

async function legacySetComposerText(element: HTMLElement, text: string): Promise<void> {
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
  // Method 1: Paste event (most reliable for React)
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const pasted = element.dispatchEvent(new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  }));
  await waitForUiSettle();
  if (normalizedConversationText(element).length > 0) return;
  // Method 2: execCommand
  element.focus();
  selectComposerContents(element);
  if (document.execCommand("insertText", false, text)) {
    await waitForUiSettle();
    if (normalizedConversationText(element).length > 0) return;
  }
  // Method 3: Direct textContent + events
  element.textContent = text;
  dispatchInputEvents(element, text);
}

async function setComposerText(element: HTMLElement, text: string): Promise<void> {
  clearComposer(element);
  await waitForUiSettle();
  if (await websiteAdapter.insertPrompt(element, text)) return;
  await legacySetComposerText(element, text);
}

async function waitForUiSettle(): Promise<void> {
  const nextFrameOrTimeout = () =>
    new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = window.setTimeout(finish, 32);
      requestAnimationFrame(() => {
        window.clearTimeout(timer);
        finish();
      });
    });
  await nextFrameOrTimeout();
  await nextFrameOrTimeout();
  await new Promise((resolve) => window.setTimeout(resolve, 80));
}

async function waitForComposer(timeoutMs = 10_000): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composer = websiteAdapter.findComposer() ??
      firstInRoots(definition.composerSelectors);
    if (composer) return composer;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("Provider composer not found.");
}

async function waitForSubmit(timeoutMs = 5_000): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composer = websiteAdapter.findComposer();
    const submit = websiteAdapter.findSubmit(composer) ??
      firstInRoots(definition.submitSelectors);
    if (submit || definition.submitWithEnter) return submit ?? undefined;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return undefined;
}

function submitLooksBusy(submit?: HTMLElement): boolean {
  return websiteAdapter.isSubmitPending(submit);
}

function submitConfirmTimeoutMs(): number {
  const override = (window as unknown as { __aihubSubmitConfirmTimeoutMs?: unknown })
    .__aihubSubmitConfirmTimeoutMs;
  return typeof override === "number" && override > 0
    ? override
    : DEFAULT_SUBMIT_CONFIRM_TIMEOUT_MS;
}

function userTurnContainsSnippet(snippet: string, composer: HTMLElement): boolean {
  if (!snippet) return false;
  const candidates = queryAllInRoots<HTMLElement>(
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
    return normalizedConversationText(candidate).includes(snippet);
  });
}

async function sentSuccessfully(
  text: string,
  baselineUrl: string,
  composer: HTMLElement,
  submit?: HTMLElement,
): Promise<boolean> {
  const snippet = text.trim().slice(0, 80);
  const deadline = Date.now() + submitConfirmTimeoutMs();
  while (Date.now() < deadline) {
    const authReason = websiteAdapter.detectAuthInterruption();
    if (authReason) {
      throw new Error(authReason);
    }
    const currentComposer = websiteAdapter.findComposer() ?? composer;
    const composerText = normalizedConversationText(currentComposer);
    const assistant = assistantElement();
    if (assistant) {
      const aText = normalizedConversationText(assistant);
      if (aText && aText !== assistantBaseline) return true;
    }
    if (websiteAdapter.hasUserTurnWithSnippet(snippet, currentComposer)) return true;
    if (providerId === "deepseek") {
      if (hasStopButton() || completionRequestSeen) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      continue;
    }
    if (snippet && !composerText.includes(snippet)) return true;
    if (submitLooksBusy(submit)) return true;
    if (!networkIdle || networkActiveCount > 0) return true;
    if (hasStopButton()) return true;
    if (providerId !== "qianwen" && location.href !== baselineUrl) return true;
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
  const composerText = normalizedConversationText(composer).slice(0, 60);
  throw new Error(
    `Submission detection failed: composer=${hasComposer} submit=${hasSubmit} composerText="${composerText}" assistant="${aText}" url=${location.href === baselineUrl ? "same" : "changed"}`,
  );
}

async function recoverDeepSeekSessionCreation(
  text: string,
  baselineUrl: string,
  originalComposer: HTMLElement,
  originalSubmit?: HTMLElement,
): Promise<{ composer: HTMLElement; submit?: HTMLElement }> {
  if (providerId !== "deepseek" || !text) {
    return { composer: originalComposer, submit: originalSubmit };
  }
  const creationDeadline = Date.now() + 5_000;
  while (Date.now() < creationDeadline) {
    const sessionCreated =
      location.href !== baselineUrl ||
      /chat_session\/create/i.test(lastNetworkUrl);
    if (!sessionCreated) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      continue;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 750));
    const currentComposer = await waitForComposer(5_000);
    const snippet = text.trim().slice(0, 80);
    const existingAssistant = assistantElement();
    if (
      websiteAdapter.hasUserTurnWithSnippet(snippet, currentComposer) ||
      (existingAssistant &&
        normalizedConversationText(existingAssistant) !== assistantBaseline) ||
      completionRequestSeen
    ) {
      return {
        composer: currentComposer,
        submit: websiteAdapter.findSubmit(currentComposer) ?? originalSubmit,
      };
    }

    await setComposerText(currentComposer, text);
    const composerText = normalizedConversationText(currentComposer);
    if (!composerText.includes(text.slice(0, 10))) {
      throw new Error("DeepSeek prompt was lost while creating the new session.");
    }
    await waitForUiSettle();
    const currentSubmit = websiteAdapter.findSubmit(currentComposer) ??
      await waitForSubmit();
    if (!currentSubmit) {
      throw new Error("DeepSeek send button was not found after session creation.");
    }
    const submitted = await websiteAdapter.submit(currentComposer, currentSubmit);
    if (!submitted) currentSubmit.click();
    emitStatus("submitting", "deepseek-session-created-resubmitted");
    emitDebugSnapshot();
    return { composer: currentComposer, submit: currentSubmit };
  }
  return { composer: originalComposer, submit: originalSubmit };
}

function isAuthInterruptionDetail(detail: string): boolean {
  return /login|verification|auth|required before sending|blocking the composer|composer is not ready yet/i.test(detail);
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

function assertNoAuthInterruption(): void {
  const reason = websiteAdapter.detectAuthInterruption();
  if (!reason) return;
  emitGenerationFailure("auth_required", "checking-auth", reason);
  throw new Error(reason);
}

async function prepareTrustedSend(text: string): Promise<ProviderInteractionTarget> {
  if (activeMessageId) {
    throw new Error("A provider generation transaction is already active.");
  }
  activePromptText = normalizeTrustedText(text);
  trustedBaselineUrl = location.href;
  trustedTransactionArmed = false;
  trustedTransportSeen = false;
  trustedSubmissionConfirmed = false;
  trustedRetryUsed = false;
  trustedExternalRetry = false;
  completionRequestSeen = false;
  emitStatus("checking-auth");
  const state = await waitForReadyState();
  if (!state.authenticated) {
    const detail = state.reason ?? "Provider authentication is required.";
    emitGenerationFailure("auth_required", "checking-auth", detail);
    throw new Error(detail);
  }
  assertNoAuthInterruption();
  emitStatus("capturing-anchor");
  const composer = await waitForComposer();
  captureConversationBaseline();
  emitStatus("typing-message", "trusted-composer-located");
  return interactionTarget(composer, "composer", "text");
}

async function verifyTrustedInput(text: string): Promise<ProviderTextVerification> {
  const expected = normalizeTrustedText(text);
  const composer = await waitForComposer();
  const actual = composerText(composer);
  const target = interactionTarget(composer, "composer", "text");
  const verification = {
    matched: actual === expected,
    actualLength: actual.length,
    expectedLength: expected.length,
    actualHash: stableTextHash(actual),
    expectedHash: stableTextHash(expected),
    fingerprint: target.fingerprint,
  };
  emitStatus(
    "typing-message",
    verification.matched
      ? `trusted-input-verified:${verification.actualLength}:${verification.actualHash}`
      : `trusted-input-mismatch:${verification.actualLength}/${verification.expectedLength}`,
  );
  return verification;
}

async function trustedSubmitTarget(): Promise<ProviderInteractionTarget> {
  const composer = await waitForComposer();
  const submit = await waitForSubmit();
  if (submit) {
    return interactionTarget(submit, "submit", "click");
  }
  if (definition.submitWithEnter) {
    return interactionTarget(composer, "submit", "enter");
  }
  throw new Error("Provider send button not found.");
}

function initializeTrustedGeneration(): void {
  lastSettledAssistant = undefined;
  activeMessageId = crypto.randomUUID();
  if (activeAnchor) {
    emit({
      type: "message.anchor-captured",
      messageId: activeMessageId,
      detail: `${activeAnchor.elementSignature}:${activeAnchor.sequence}`,
    });
  }
  boundAssistant = undefined;
  latestText = "";
  latestContent = [];
  lastMutationAt = Date.now();
  generationStartedAt = lastMutationAt;
  networkIdle = activeTransportRequests.size === 0;
  trustedTransportSeen = false;
  trustedSubmissionConfirmed = false;
}

async function armTrustedSend(text: string): Promise<ProviderInteractionTarget> {
  const verification = await verifyTrustedInput(text);
  if (!verification.matched) {
    throw new Error(
      `Trusted text verification failed: actual=${verification.actualLength}/${verification.actualHash} expected=${verification.expectedLength}/${verification.expectedHash}.`,
    );
  }
  assertNoAuthInterruption();
  const target = await trustedSubmitTarget();
  initializeTrustedGeneration();
  trustedTransactionArmed = true;
  emitStatus("submitting", `trusted-${target.inputMethod}-target:${target.fingerprint}`);
  return target;
}

function currentTrustedSubmitEvidence(): ProviderSubmitEvidence {
  const composer = websiteAdapter.findComposer() ??
    firstInRoots(definition.composerSelectors);
  const snippet = activePromptText.trim().slice(0, 80);
  const userTurnSeen = Boolean(
    composer &&
      snippet &&
      websiteAdapter.hasUserTurnWithSnippet(snippet, composer),
  );
  const assistant = assistantElement();
  const assistantText = assistant ? normalizedConversationText(assistant) : "";
  const assistantStarted = Boolean(
    assistantText && assistantText !== assistantBaseline,
  );
  const sessionCreated = Boolean(
    trustedBaselineUrl &&
      (location.href !== trustedBaselineUrl ||
        /chat_session\/create/i.test(lastNetworkUrl)),
  );
  const transportSeen = trustedTransportSeen || completionRequestSeen;
  const confirmed = trustedExternalRetry
    ? transportSeen || assistantStarted
    : userTurnSeen || transportSeen || assistantStarted;
  return {
    confirmed,
    userTurnSeen,
    transportSeen,
    assistantStarted,
    sessionCreated,
    retryAllowed:
      providerId === "deepseek" &&
      sessionCreated &&
      !userTurnSeen &&
      !transportSeen &&
      !assistantStarted &&
      !trustedRetryUsed,
    currentConversationId:
      websiteAdapter.getCurrentConversation()?.externalId ?? location.href,
  };
}

async function confirmTrustedSubmit(): Promise<ProviderSubmitEvidence> {
  if (!activeMessageId || !trustedTransactionArmed) {
    throw new Error("Trusted provider submission was not armed.");
  }
  emitStatus("confirming-submit");
  const deadline = Date.now() + submitConfirmTimeoutMs();
  let evidence = currentTrustedSubmitEvidence();
  let retryEligibleSince = evidence.retryAllowed ? Date.now() : 0;
  while (!evidence.confirmed && Date.now() < deadline) {
    assertNoAuthInterruption();
    if (evidence.retryAllowed) {
      if (!retryEligibleSince) retryEligibleSince = Date.now();
      if (Date.now() - retryEligibleSince >= 750) break;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    } else {
      retryEligibleSince = 0;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    evidence = currentTrustedSubmitEvidence();
  }
  trustedSubmissionConfirmed = evidence.confirmed;
  emitStatus(
    "confirming-submit",
    [
      evidence.confirmed ? "trusted-submit-confirmed" : "trusted-submit-unconfirmed",
      `user=${evidence.userTurnSeen}`,
      `transport=${evidence.transportSeen}`,
      `assistant=${evidence.assistantStarted}`,
      `session=${evidence.sessionCreated}`,
      `retry=${evidence.retryAllowed}`,
    ].join(" "),
  );
  return evidence;
}

async function prepareDeepSeekTrustedRetry(): Promise<ProviderInteractionTarget> {
  const evidence = currentTrustedSubmitEvidence();
  if (providerId !== "deepseek" || !evidence.retryAllowed) {
    throw new Error("DeepSeek trusted retry is not allowed by current evidence.");
  }
  trustedRetryUsed = true;
  trustedTransactionArmed = false;
  const composer = await waitForComposer(5_000);
  emitStatus("typing-message", "deepseek-session-created-reacquired-composer");
  return interactionTarget(composer, "composer", "text");
}

async function prepareTrustedRetrySubmit(): Promise<ProviderInteractionTarget> {
  if (providerId !== "deepseek" || !trustedRetryUsed || trustedTransactionArmed) {
    throw new Error("DeepSeek trusted retry was not prepared.");
  }
  const verification = await verifyTrustedInput(activePromptText);
  if (!verification.matched) {
    throw new Error("DeepSeek trusted retry text verification failed.");
  }
  const target = await trustedSubmitTarget();
  trustedTransportSeen = false;
  completionRequestSeen = false;
  trustedTransactionArmed = true;
  emitStatus("submitting", `deepseek-trusted-retry-${target.inputMethod}`);
  return target;
}

function startTrustedGeneration(flaky = false): void {
  if (!activeMessageId || !trustedSubmissionConfirmed) {
    throw new Error("Trusted provider submission was not confirmed.");
  }
  if (
    location.href !== trustedBaselineUrl &&
    definition.conversationUrlPattern
  ) {
    const match = definition.conversationUrlPattern.exec(location.href);
    if (match?.[1]) {
      emit({ type: "conversation.changed", externalId: location.href });
    }
  }
  emitStatus("waiting-first-token");
  emit({ type: "message.started", messageId: activeMessageId });
  if (flaky) {
    emitStatus(
      "waiting-first-token",
      "Flaky: the provider website retry control was used once after an explicit external transport failure.",
    );
  }
  emitAssistantBindingPhase(
    boundAssistant
      ? "Assistant turn was bound after the captured conversation anchor."
      : "Waiting for an assistant turn after the captured conversation anchor.",
  );
  collectGenerationUpdate();
  flushStreamUpdate(true);
  scheduleCompletionCheck();
}

function abortTrustedSend(): void {
  resetActiveGeneration();
}

async function prepareTrustedExternalRetry(
  text: string,
): Promise<ProviderInteractionTarget> {
  activePromptText = normalizeTrustedText(text);
  const deadline = Date.now() + 5_000;
  let retry: HTMLElement | undefined;
  while (Date.now() < deadline) {
    retry = queryAllInRoots<HTMLElement>("button,[role='button']")
      .find((candidate) => {
        if (!visible(candidate)) return false;
        const label = [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          normalizedConversationText(candidate),
        ].filter(Boolean).join(" ");
        return /重试|再试一次|重新生成|retry|try again|regenerate/i.test(label);
      });
    if (retry) break;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  if (!retry) {
    throw new Error(
      "The provider reported an external failure but exposed no trusted retry control.",
    );
  }
  captureConversationBaseline();
  trustedBaselineUrl = location.href;
  completionRequestSeen = false;
  trustedTransportSeen = false;
  trustedSubmissionConfirmed = false;
  trustedExternalRetry = true;
  initializeTrustedGeneration();
  trustedExternalRetry = true;
  trustedTransactionArmed = true;
  emitStatus("submitting", "trusted-provider-retry-control");
  return interactionTarget(retry, "retry", "click");
}

async function sendMessage(text: string): Promise<void> {
  activePromptText = text;
  emitStatus("checking-auth");
  const state = await waitForReadyState();
  if (!state.authenticated) {
    const detail = state.reason ?? "Provider authentication is required.";
    emitGenerationFailure("auth_required", "checking-auth", detail);
    throw new Error(detail);
  }
  let composer: HTMLElement;
  try {
    composer = await waitForComposer();
  } catch (e) {
    const detail = `Composer not found: ${String(e)}`;
    emitGenerationFailure("provider_composer_not_found", "typing-message", detail);
    throw new Error(detail);
  }
  emitStatus("capturing-anchor");
  captureConversationBaseline();
  if (text) {
    emitStatus("typing-message");
    try {
      await setComposerText(composer, text);
    } catch (e) {
      const detail = `Text entry failed: ${String(e)}`;
      emitGenerationFailure("provider_compose_failed", "typing-message", detail);
      throw new Error(detail);
    }
    const composerText = normalizedConversationText(composer);
    if (!composerText.includes(text.slice(0, 10))) {
      const detail =
        `Text not in composer after entry. Composer has ${composerText.length} chars: "${composerText.slice(0, 50)}"`;
      emitGenerationFailure("provider_compose_failed", "typing-message", detail);
      throw new Error(detail);
    }
    emitStatus("typing-message", "text-inserted");
    emitDebugSnapshot();
  }
  await waitForUiSettle();
  emitStatus("typing-message", "ui-settled");
  emitDebugSnapshot();
  assertNoAuthInterruption();
  emitStatus("submitting");
  emitDebugSnapshot();
  const submit = await waitForSubmit();
  if (!submit && !definition.submitWithEnter) {
    emit({
      type: "adapter.degraded",
      reason: "The provider send button could not be located.",
    });
    emitGenerationFailure(
      "provider_submit_not_found",
      "submitting",
      "Provider send button not found.",
    );
    throw new Error("Provider send button not found.");
  }
  emitStatus("submitting", submit ? "submit-found" : "submit-with-enter");
  emitDebugSnapshot();
  const baselineUrl = location.href;
  completionRequestSeen = false;
  try {
    const submitted = await websiteAdapter.submit(composer, submit);
    if (!submitted) {
      if (submit) submit.click();
      else await submitWithEnter(composer);
    }
  } catch (e) {
    const detail = `Submit action failed: ${String(e)}`;
    emitGenerationFailure("provider_submit_failed", "submitting", detail);
    throw new Error(detail);
  }
  emitStatus("submitting", "submit-dispatched");
  emitDebugSnapshot();
  emitStatus("confirming-submit");
  lastSettledAssistant = undefined;
  activeMessageId = crypto.randomUUID();
  if (activeAnchor) {
    emit({
      type: "message.anchor-captured",
      messageId: activeMessageId,
      detail: `${activeAnchor.elementSignature}:${activeAnchor.sequence}`,
    });
  }
  boundAssistant = undefined;
  latestText = "";
  latestContent = [];
  lastMutationAt = Date.now();
  generationStartedAt = lastMutationAt;
  networkIdle = networkActiveCount === 0;
  let confirmed = false;
  try {
    const recovered = await recoverDeepSeekSessionCreation(
      text,
      baselineUrl,
      composer,
      submit,
    );
    confirmed = await sentSuccessfully(
      text,
      baselineUrl,
      recovered.composer,
      recovered.submit,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitGenerationFailure(
      isAuthInterruptionDetail(detail) ? "auth_required" : "provider_submit_not_confirmed",
      isAuthInterruptionDetail(detail) ? "checking-auth" : "confirming-submit",
      detail,
    );
    resetActiveGeneration();
    throw error;
  }
  if (confirmed && location.href !== baselineUrl && definition.conversationUrlPattern) {
    const match = definition.conversationUrlPattern.exec(location.href);
    if (match?.[1]) {
      emit({ type: "conversation.changed", externalId: location.href });
    }
  }
  emitStatus("waiting-first-token");
  emit({ type: "message.started", messageId: activeMessageId });
  emitAssistantBindingPhase(
    boundAssistant
      ? "Assistant turn was bound after the captured conversation anchor."
      : "Waiting for an assistant turn after the captured conversation anchor.",
  );
  collectGenerationUpdate();
  flushStreamUpdate(true);
  scheduleCompletionCheck();
}

async function composeMessage(text: string): Promise<void> {
  emitStatus("checking-auth");
  const state = await waitForReadyState();
  if (!state.authenticated) {
    const detail = state.reason ?? "Provider authentication is required.";
    emitGenerationFailure("auth_required", "checking-auth", detail);
    throw new Error(detail);
  }
  let composer: HTMLElement;
  try {
    composer = await waitForComposer();
  } catch (e) {
    const detail = `Composer not found: ${String(e)}`;
    emitGenerationFailure("provider_composer_not_found", "typing-message", detail);
    throw new Error(detail);
  }
  emitStatus("capturing-anchor");
  captureConversationBaseline();
  if (text) {
    emitStatus("typing-message");
    try {
      await setComposerText(composer, text);
    } catch (e) {
      const detail = `Text entry failed: ${String(e)}`;
      emitGenerationFailure("provider_compose_failed", "typing-message", detail);
      throw new Error(detail);
    }
    const composerText = normalizedConversationText(composer);
    if (!composerText.includes(text.slice(0, 10))) {
      const detail =
        `Text not in composer after entry. Composer has ${composerText.length} chars: "${composerText.slice(0, 50)}"`;
      emitGenerationFailure("provider_compose_failed", "typing-message", detail);
      throw new Error(detail);
    }
  }
  await waitForUiSettle();
  assertNoAuthInterruption();
  emitStatus("recoverable-blocked", "Prompt was filled in the provider page. Review and submit it manually.");
}

function cancelGeneration(): void {
  const stop = firstInRoots(definition.stopSelectors);
  stop?.click();
  finalizeTrustedCancel();
}

function prepareTrustedCancel(): ProviderInteractionTarget {
  const stop = firstInRoots(definition.stopSelectors);
  if (!stop) throw new Error("Provider stop button not found.");
  return interactionTarget(stop, "stop", "click");
}

function finalizeTrustedCancel(): void {
  if (activeMessageId) {
    emit({
      type: "generation.failed",
      messageId: activeMessageId,
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
  ) ?? (enabled ? opener : state.control ?? opener);
  if (!target) return { available: true, enabled: current };
  const transient = enabled &&
    Boolean(opener) &&
    target !== opener &&
    (modeDefinition.disabledLabels?.length ?? 0) === 0;
  const rect = target.getBoundingClientRect();
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

function initNetworkMonitor(): void {
  if (networkMonitorInitialized) return;
  networkMonitorInitialized = true;
  const config = websiteAdapter.getNetworkMonitorConfig();
  if (!config) {
    networkIdle = true;
    return;
  }
  window.addEventListener("message", (event) => {
    const data = event.data as
      | {
          type?: string;
          phase?: "started" | "idle";
          url?: string;
          activeCount?: number;
        }
      | undefined;
    if (!data || data.type !== LEGACY_NETWORK_EVENT_TYPE) return;
    lastNetworkUrl = data.url ?? lastNetworkUrl;
    networkActiveCount = data.activeCount ?? networkActiveCount;
    if (/completion|conversation|chat|agent/i.test(data.url ?? "")) {
      completionRequestSeen = data.phase === "started" || completionRequestSeen;
    }
    if (data.phase === "started") {
      networkIdle = false;
      emit({ type: "provider.network-started", url: data.url });
      return;
    }
    if (data.phase === "idle") {
      networkIdle = true;
      emit({ type: "provider.network-idle", url: data.url });
      scheduleCompletionCheck();
    }
  });
  ipcRenderer.on("provider:transport", (_event, payload: unknown) => {
    const parsed = providerTransportEventSchema.safeParse(payload);
    if (!parsed.success) return;
    const transport = parsed.data;
    lastTransportEvent = transport;
    lastNetworkUrl = transport.urlPath;
    if (/completion|conversation|chat|agent/i.test(transport.urlPath)) {
      completionRequestSeen = completionRequestSeen ||
        (trustedTransactionArmed && transport.phase === "started");
    }
    if (transport.phase === "started") {
      activeTransportRequests.add(transport.requestId);
      if (trustedTransactionArmed) trustedTransportSeen = true;
      if (networkIdleTimer) {
        window.clearTimeout(networkIdleTimer);
        networkIdleTimer = undefined;
      }
      networkActiveCount = activeTransportRequests.size;
      networkIdle = false;
      emit({ type: "provider.network-started", url: transport.urlPath });
      return;
    }
    activeTransportRequests.delete(transport.requestId);
    networkActiveCount = activeTransportRequests.size;
    if (networkActiveCount > 0) return;
    if (networkIdleTimer) window.clearTimeout(networkIdleTimer);
    networkIdleTimer = window.setTimeout(() => {
      networkIdleTimer = undefined;
      if (activeTransportRequests.size > 0) return;
      networkIdle = true;
      emit({ type: "provider.network-idle", url: transport.urlPath });
      scheduleCompletionCheck();
    }, config.silenceThresholdMs);
  });
}

function installCleanModeShadowHook(): void {
  if (originalAttachShadow) return;
  originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function patchedAttachShadow(
    init: ShadowRootInit,
  ): ShadowRoot {
    const shadowRoot = originalAttachShadow!.call(this, init);
    if (cleanModeEnabled) {
      queueMicrotask(() => {
        if (cleanModeEnabled && !cleanModeStyles.has(shadowRoot)) {
          injectCleanModeStyle(shadowRoot);
        }
      });
    }
    return shadowRoot;
  };
}

function restoreCleanModeShadowHook(): void {
  if (!originalAttachShadow) return;
  Element.prototype.attachShadow = originalAttachShadow;
  originalAttachShadow = undefined;
}

function injectCleanModeStyle(root: Document | ShadowRoot): void {
  if (cleanModeStyles.has(root)) return;
  const css = websiteAdapter.getCleanModeCss();
  const style = document.createElement("style");
  style.id = "aihub-clean-mode";
  style.textContent = css;
  if (root instanceof Document) {
    root.documentElement.appendChild(style);
  } else {
    root.appendChild(style);
  }
  cleanModeStyles.set(root, style);
}

function setCleanMode(enabled: boolean): void {
  cleanModeEnabled = enabled;
  cleanModeStyles.forEach((style) => style.remove());
  cleanModeStyles.clear();
  if (!enabled) return;
  installCleanModeShadowHook();
  for (const root of roots()) {
    if (!(root instanceof Document || root instanceof ShadowRoot)) continue;
    injectCleanModeStyle(root);
  }
}

function buildDebugSnapshot(): ProviderDebugSnapshot {
  const composer = websiteAdapter.findComposer();
  const submit = websiteAdapter.findSubmit(composer);
  const assistant = assistantElement();
  const signals = currentCompletionSignals();
  const now = Date.now();
  const messages = websiteAdapter.messageElements();
  const currentConversation = websiteAdapter.getCurrentConversation();
  return {
    provider: providerId,
    url: location.href,
    composer: websiteAdapter.describeElement(composer),
    submit: websiteAdapter.describeElement(submit),
    submitCandidates: describeSubmitCandidates(composer),
    anchor: activeAnchor
      ? `${activeAnchor.elementSignature}:${activeAnchor.sequence}`
      : "none",
    assistant: websiteAdapter.describeElement(assistant ?? null),
    activeMessageId,
    assistantBinding: boundAssistant?.detail,
    latestTextLength: latestText.length,
    isGenerating: websiteAdapter.isGenerating(),
    networkActiveCount,
    networkIdle,
    lastNetworkUrl: lastNetworkUrl || undefined,
    lastTransportEvent,
    documentVisibility: document.visibilityState,
    documentHasFocus: document.hasFocus(),
    lastMutationAt,
    completionDecision: lastCompletionDecision,
    completionSignals: {
      textLength: signals.text.length,
      hasStopButton: signals.hasStopButton,
      hasStreamingIndicator: signals.hasStreamingIndicator,
      networkIdle: signals.networkIdle ?? true,
      hasRecoverableBlocker: signals.hasRecoverableBlocker ?? false,
      recoverableBlockerReason: websiteAdapter.findRecoverableBlocker(),
      stableMs: signals.lastMutationAt ? Math.max(0, now - signals.lastMutationAt) : 0,
      elapsedMs: signals.startedAt ? Math.max(0, now - signals.startedAt) : 0,
    },
    fallbackUsed: boundAssistant?.fallbackUsed ?? false,
    currentConversationId: currentConversation?.externalId,
    turnCount: messages.length,
    userMessageCount: messages.filter((message) => message.role === "user").length,
    assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
    virtualScanRounds: lastHistoryScanRounds,
    historyFallbackReason: lastHistoryFallbackReason,
  };
}

function debugSnapshot(): ProviderDebugSnapshot {
  const current = buildDebugSnapshot();
  if (activeMessageId || !lastSettledSnapshot) {
    return current;
  }
  return {
    ...current,
    anchor: lastSettledSnapshot.anchor,
    assistant: lastSettledSnapshot.assistant,
    assistantBinding: lastSettledSnapshot.assistantBinding,
    latestTextLength: lastSettledSnapshot.latestTextLength,
    lastMutationAt: lastSettledSnapshot.lastMutationAt,
    completionDecision: lastSettledSnapshot.completionDecision,
    completionSignals: lastSettledSnapshot.completionSignals,
    fallbackUsed: lastSettledSnapshot.fallbackUsed,
  };
}

function describeSubmitCandidates(composer: HTMLElement | null): string[] {
  const composerRect = composer?.getBoundingClientRect();
  const scope = composer?.parentElement?.closest(
    "form,section,footer,main,[class*='editor'],[class*='input'],[class*='composer'],[class*='footer'],[class*='bottom'],[class*='chat']",
  ) ?? composer?.parentElement ?? document.body;
  let controls = Array.from(
    scope.querySelectorAll<HTMLElement>("button,[role='button']"),
  ).filter((element) => visible(element));
  if (controls.length === 0) {
    controls = Array.from(
      document.body.querySelectorAll<HTMLElement>("button,[role='button']"),
    ).filter((element) => visible(element));
  }

  return controls
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const dx = composerRect ? Math.round(rect.left - composerRect.right) : 0;
      const dy = composerRect ? Math.round(rect.top - composerRect.top) : 0;
      const label = controlLabel(element) || "(icon-only)";
      const score = composerRect
        ? Math.abs(dx) + Math.abs(dy)
        : 0;
      return {
        description:
          `${websiteAdapter.describeElement(element)} label=${label} dx=${dx} dy=${dy}`,
        score,
      };
    })
    .sort((left, right) => left.score - right.score)
    .slice(0, 8)
    .map((entry) => entry.description);
}

function emitDebugSnapshot(): ProviderDebugSnapshot {
  const snapshot = debugSnapshot();
  emit({ type: "provider.debug-snapshot", snapshot });
  return snapshot;
}

function syncLatestResponse(): boolean {
  if (!activeMessageId) {
    const recoveredBinding = activeAnchor
      ? websiteAdapter.findAssistantAfterAnchor(activeAnchor)
      : websiteAdapter.fallbackAssistant();
    boundAssistant = recoveredBinding ?? undefined;
    const assistant = boundAssistant?.element;
    const text = assistant ? normalizedConversationText(assistant) : "";
    if (!assistant || !text) {
      const settled = lastSettledAssistant;
      if (!settled || settled.url !== location.href || !settled.text) return false;
      activeMessageId = crypto.randomUUID();
      latestText = settled.text;
      latestContent = settled.content;
      lastMutationAt = Date.now();
      generationStartedAt = lastMutationAt;
      emit({ type: "message.started", messageId: activeMessageId });
      emit({
        type: "message.assistant-bound",
        messageId: activeMessageId,
        detail: "cached-last-completed-assistant",
      });
      emit({
        type: "message.snapshot",
        messageId: activeMessageId,
        content: settled.content,
        text: settled.text,
        providerHtml: settled.providerHtml,
        phase: "streaming",
        detail: "Recovered from the last completed provider snapshot.",
      });
      completeGeneration();
      return true;
    }
    activeMessageId = crypto.randomUUID();
    if (boundAssistant && activeAnchor) {
      emit({
        type: "message.assistant-bound",
        messageId: activeMessageId,
        detail: boundAssistant.detail,
      });
    }
    latestText = text;
    latestContent = getAssistantContent(text, getAssistantHtml());
    lastMutationAt = Date.now();
    generationStartedAt = lastMutationAt;
    emit({ type: "message.started", messageId: activeMessageId });
    emit({
      type: "message.snapshot",
      messageId: activeMessageId,
      content: latestContent,
      text,
      providerHtml: getAssistantHtml(),
      phase: "streaming",
      detail: "Recovered from provider page.",
    });
    completeGeneration();
    return true;
  }
  boundAssistant = undefined;
  collectGenerationUpdate();
  flushStreamUpdate(true);
  if (!latestText && !boundAssistant) return false;
  completeGeneration();
  return true;
}

function disposePreload(): void {
  setCleanMode(false);
  restoreCleanModeShadowHook();
  if (observer) {
    observer.disconnect();
    observer = undefined;
  }
  if (pollingTimer) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  if (conversationDirtyTimer) {
    window.clearTimeout(conversationDirtyTimer);
    conversationDirtyTimer = undefined;
  }
  if (completionTimer) {
    window.clearTimeout(completionTimer);
    completionTimer = undefined;
  }
  if (capabilityTimer) {
    window.clearTimeout(capabilityTimer);
    capabilityTimer = undefined;
  }
  if (streamFlushTimer) {
    window.clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }
  if (networkIdleTimer) {
    window.clearTimeout(networkIdleTimer);
    networkIdleTimer = undefined;
  }
  activeTransportRequests.clear();
  resetActiveGeneration();
}

ipcRenderer.on("provider:command", async (_event, command: ProviderCommand) => {
  try {
    let value: unknown;
    if (command.type === "detect-state") {
      value = detectState();
    } else if (command.type === "send-message") {
      const text = command.payload?.text?.trim();
      await sendMessage(text ?? "");
    } else if (command.type === "prepare-trusted-send") {
      value = await prepareTrustedSend(command.payload?.text ?? "");
    } else if (command.type === "verify-trusted-input") {
      value = await verifyTrustedInput(command.payload?.text ?? "");
    } else if (command.type === "arm-trusted-send") {
      value = await armTrustedSend(command.payload?.text ?? "");
    } else if (command.type === "confirm-trusted-submit") {
      value = await confirmTrustedSubmit();
    } else if (command.type === "prepare-deepseek-trusted-retry") {
      value = await prepareDeepSeekTrustedRetry();
    } else if (command.type === "trusted-submit-target") {
      value = await prepareTrustedRetrySubmit();
    } else if (command.type === "start-trusted-generation") {
      startTrustedGeneration(Boolean(command.payload?.flaky));
    } else if (command.type === "abort-trusted-send") {
      abortTrustedSend();
    } else if (command.type === "prepare-trusted-cancel") {
      value = prepareTrustedCancel();
    } else if (command.type === "finalize-trusted-cancel") {
      finalizeTrustedCancel();
    } else if (command.type === "prepare-trusted-external-retry") {
      value = await prepareTrustedExternalRetry(command.payload?.text ?? "");
    } else if (command.type === "compose-message") {
      const text = command.payload?.text?.trim();
      await composeMessage(text ?? "");
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
    } else if (command.type === "capture-anchor") {
      activeAnchor = websiteAdapter.captureAnchor();
      value = activeAnchor;
    } else if (command.type === "sync-latest-response") {
      value = syncLatestResponse();
    } else if (command.type === "list-web-conversations") {
      value = await listWebConversations();
    } else if (command.type === "extract-current-conversation") {
      const snapshot: WebsiteConversationSnapshot = await websiteAdapter.extractConversationSnapshot();
      lastHistoryScanRounds = snapshot.scanRounds;
      lastHistoryFallbackReason = snapshot.fallbackReason;
      value = snapshot;
    } else if (command.type === "get-debug-snapshot") {
      value = emitDebugSnapshot();
    } else if (command.type === "set-clean-mode") {
      setCleanMode(Boolean(command.payload?.cleanMode));
    } else if (command.type === "init-network-monitor") {
      initNetworkMonitor();
    } else if (command.type === "check-completion") {
      runCompletionCheck();
    } else if (command.type === "dispose") {
      disposePreload();
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
    initNetworkMonitor();
    observeGeneration();
    injectProviderControls();
  }, { once: true });
} else {
  initNetworkMonitor();
  observeGeneration();
  injectProviderControls();
}

function injectProviderControls(): void {
  if (document.getElementById("aihub-provider-controls")) return;
  const host = document.createElement("div");
  host.id = "aihub-provider-controls";
  host.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    .controls{all:initial;display:flex;align-items:center;gap:4px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    button{all:initial;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.58);color:#fff;font:600 16px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;border:1px solid rgba(255,255,255,.12);opacity:.58;transition:opacity .15s,background .15s,transform .15s}
    button:hover{opacity:1;background:rgba(0,0,0,.78)}
    button:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
    button:disabled{cursor:wait;opacity:.82}
    button[data-state="syncing"]{animation:aihub-spin .8s linear infinite}
    button[data-state="success"]{background:rgba(22,101,52,.9);opacity:1}
    button[data-state="partial"]{background:rgba(161,98,7,.92);opacity:1}
    button[data-state="error"]{background:rgba(153,27,27,.92);opacity:1}
    .status{all:initial;box-sizing:border-box;display:none;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:12px;background:rgba(0,0,0,.78);color:#fff;padding:7px 10px;font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.28)}
    .status[data-visible="true"]{display:block}
    @keyframes aihub-spin{to{transform:rotate(360deg)}}
  </style>
  <div class="controls">
    <button type="button" data-action="hide" title="Hide provider" aria-label="Hide provider">&#x25C0;</button>
    <button type="button" data-action="sync-current" title="Sync current conversation" aria-label="Sync current conversation">&#x21BB;</button>
    <button type="button" data-action="debug" title="Debug DOM" aria-label="Debug DOM">&#x1F41B;</button>
    <span class="status" role="status" aria-live="polite"></span>
  </div>`;
  const buttons = shadow.querySelectorAll("button");
  const hideBtn = buttons[0]!;
  const syncBtn = buttons[1]!;
  const debugBtn = buttons[2]!;
  const status = shadow.querySelector<HTMLElement>(".status")!;
  let resetTimer: number | undefined;
  const setSyncState = (
    state: "idle" | "syncing" | "success" | "partial" | "error",
    message = "",
  ) => {
    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
      resetTimer = undefined;
    }
    syncBtn.dataset.state = state;
    syncBtn.disabled = state === "syncing";
    syncBtn.textContent =
      state === "success" ? "\u2713" :
      state === "partial" || state === "error" ? "!" :
      "\u21BB";
    syncBtn.title = message || "Sync current conversation";
    syncBtn.setAttribute(
      "aria-label",
      message || "Sync current conversation",
    );
    status.textContent = message;
    status.dataset.visible = message ? "true" : "false";
    if (state === "success" || state === "partial") {
      resetTimer = window.setTimeout(() => setSyncState("idle"), 2_800);
    }
  };
  hideBtn.addEventListener("click", () => {
    void ipcRenderer.invoke("provider:hide-self");
  });
  syncBtn.addEventListener("click", () => {
    if (syncBtn.disabled) return;
    setSyncState("syncing", "Syncing current conversation...");
    void ipcRenderer.invoke("provider:sync-current-conversation")
      .then((value: unknown) => {
        const result = currentWebConversationSyncResultSchema.parse(value);
        const message = result.partial
          ? `Partially synced ${result.syncedMessages} messages.`
          : `Synced ${result.syncedMessages} messages.`;
        setSyncState(result.partial ? "partial" : "success", message);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error
          ? error.message
          : String(error);
        setSyncState("error", message || "Current conversation sync failed.");
      });
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
      const text = websiteAdapter.extractText(e).slice(0, 100);
      info.push(`${tag}${cls}${role}${data} → "${text}"`);
    }
    info.push(`\n--- assistantElement() result ---`);
    const assistant = assistantElement() ?? websiteAdapter.fallbackAssistant()?.element;
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
