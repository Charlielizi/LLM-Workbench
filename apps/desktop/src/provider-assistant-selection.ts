import type { ProviderId } from "@aihub/core";
import { plainTextWithShadow } from "./provider-dom-text";

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function score(provider: ProviderId, element: HTMLElement, selectorIndex: number): number {
  let value = 1_000 - selectorIndex * 10;
  if (!visible(element)) value -= 500;
  if (element.closest("#input-engine-container,footer,nav,aside,form")) value -= 1_000;
  const text = plainTextWithShadow(element);
  value += Math.min(text.length, 400);
  if (provider === "qianwen") {
    if (element.matches("div[class*='message-select-wrapper-answer']")) value += 800;
    if (element.matches("div[class*='chat-answers-card-wrap']")) value += 700;
    if (element.matches("div.answer-common-card,div.qk-markdown")) value += 600;
  }
  if (provider === "doubao") {
    if (element.matches("[data-message-id]")) value += 900;
    if (element.matches("[data-copy-telemetry='right_click_copy']")) value += 500;
    if (element.matches("[data-container-type='block-v2']")) value += 400;
    if (element.matches("[class*='bot-message']")) value += 300;
    if (element.matches("[class*='response-content']")) value += 300;
    if (element.matches("[class*='chat-message'][class*='bot']")) value += 300;
    if (element.matches("[class*='markdown-body']")) value += 200;
    if (element.matches("[class*='assistant-message']")) value += 200;
  }
  return value;
}

export function pickAssistantElement(
  provider: ProviderId,
  selectors: readonly string[],
  queryAll: (selector: string) => HTMLElement[],
): HTMLElement | undefined {
  let best: { element: HTMLElement; score: number } | undefined;
  selectors.forEach((selector, selectorIndex) => {
    for (const element of queryAll(selector)) {
      const next = score(provider, element, selectorIndex);
      if (!best || next >= best.score) {
        best = { element, score: next };
      }
    }
  });
  return best?.element;
}
