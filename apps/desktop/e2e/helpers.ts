import { expect, type Locator, type Page } from "@playwright/test";

export async function completeOnboarding(page: Page): Promise<void> {
  if (!await page.getByTestId("welcome-onboarding").isVisible()) return;
  const onboarding = page.getByTestId("welcome-onboarding");
  const title = onboarding.locator("h1");
  const firstTitle = await title.textContent();
  await clickOnboardingAction(onboarding.getByRole("button", { name: "Next" }));
  await expect(title).not.toHaveText(firstTitle ?? "");
  const secondTitle = await title.textContent();
  await clickOnboardingAction(onboarding.getByRole("button", { name: "Next" }));
  await expect(title).not.toHaveText(secondTitle ?? "");
  await clickOnboardingAction(
    onboarding.getByRole("button", { name: "Enter workspace" }),
  );
  await expect(page.getByTestId("welcome-workspace")).toBeVisible();
}

async function clickOnboardingAction(button: Locator): Promise<void> {
  await activate(button);
}

export async function createChat(page: Page): Promise<void> {
  await activate(page.getByTestId("new-conversation-chatgpt"));
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeEditable();
}

export async function activate(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await control.evaluate((element) => (element as HTMLElement).click());
}

export async function openContextMenu(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  });
}

export async function dispatchKey(
  page: Page,
  key: string,
  options: { code?: string; control?: boolean } = {},
): Promise<void> {
  await page.evaluate(({ key: pressedKey, code, control }) => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: pressedKey,
      code: code ?? pressedKey,
      ctrlKey: control,
      bubbles: true,
      cancelable: true,
    }));
  }, { key, code: options.code, control: options.control ?? false });
}

export async function dispatchInputKey(
  input: Locator,
  key: string,
  code = key,
): Promise<void> {
  await input.evaluate((element, event) => {
    element.dispatchEvent(new KeyboardEvent("keydown", {
      ...event,
      bubbles: true,
      cancelable: true,
    }));
  }, { key, code });
}

export async function expectInsideViewport(
  page: Page,
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}
