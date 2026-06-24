import { ipcRenderer } from "electron";
import {
  firstMatch,
  providerDefinitions,
  type ProviderDefinition,
} from "@aihub/adapters";
import type {
  NormalizedMessage,
  ProviderEvent,
  ProviderId,
  ProviderState,
} from "@aihub/core";

interface ProviderCommand {
  requestId: string;
  type: "detect-state" | "send-message" | "cancel-generation";
  payload?: { text?: string };
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

function emit(event: ProviderEvent): void {
  ipcRenderer.send("provider:event", event);
}

function detectState(): ProviderState {
  const composer = firstMatch(document, definition.composerSelectors);
  const loginMarker = firstMatch(document, definition.loginMarkers);
  // A usable composer is the strongest cross-provider signal that the user can
  // chat. Many provider shells keep hidden login buttons or phone inputs in
  // the DOM after authentication, so login markers must not override it.
  const authenticated = Boolean(composer);
  return {
    authenticated,
    ready: authenticated,
    degraded: false,
    reason: authenticated
      ? undefined
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
    if (!activeMessageId) return;
    const nextText = getAssistantText();
    if (!nextText || nextText === latestText) return;

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
    scheduleCompletionCheck();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  emitAuthIfChanged();
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
  setComposerText(composer, text);
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

ipcRenderer.on(
  "provider:command",
  async (_event, command: ProviderCommand) => {
    try {
      let value: unknown;
      if (command.type === "detect-state") {
        value = detectState();
      } else if (command.type === "send-message") {
        const text = command.payload?.text?.trim();
        if (!text) throw new Error("Message text is empty.");
        await sendMessage(text);
      } else if (command.type === "cancel-generation") {
        cancelGeneration();
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
