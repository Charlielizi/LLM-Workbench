import { expect, type Locator, type Page } from "@playwright/test";

export async function completeOnboarding(page: Page): Promise<void> {
  if (!await page.getByTestId("welcome-onboarding").isVisible()) return;
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(page.getByTestId("welcome-workspace")).toBeVisible();
}

export async function createChat(page: Page): Promise<void> {
  await page.getByTestId("new-conversation-chatgpt").click();
  await expect(page.getByTestId("chat-view")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeEditable();
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
