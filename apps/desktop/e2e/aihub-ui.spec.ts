import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  activate,
  completeOnboarding,
  createChat,
  dispatchInputKey,
  dispatchKey,
  expectInsideViewport,
  openContextMenu,
} from "./helpers";

test("onboards, creates a conversation, and renders a streamed mock reply", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  const composer = page.getByTestId("composer-input");
  await composer.fill("[mock:slow] LLM Workbench autonomous UI test");
  await activate(page.getByTestId("send-message"));
  await expect(composer).toHaveValue("");

  await expect(page.locator('[data-message-role="user"]')).toContainText(
    "LLM Workbench autonomous UI test",
  );
  await expect(page.getByTestId("stop-generation")).toBeVisible();
  const assistant = page.locator('[data-message-role="assistant"]').last();
  await expect(assistant).toContainText(
    "Mock ChatGPT reply: LLM Workbench autonomous UI test",
    { timeout: 12_000 },
  );
  await expect(assistant).toHaveAttribute("data-message-status", "completed");
  await expect(page.getByTestId("send-message")).toBeVisible();
  await expect(page.getByText("ChatGPT signed in", { exact: true })).toBeHidden();
  await expectInsideViewport(page, page.getByTestId("composer"));
  await expect(page).toHaveScreenshot("completed-chat.png");
});

test("supports keyboard navigation, theme switching, settings, and search", async ({ page }) => {
  await completeOnboarding(page);

  await dispatchKey(page, "k", { code: "KeyK", control: true });
  await expect(page.getByTestId("conversation-search")).toBeFocused();
  await activate(page.getByRole("banner").getByLabel("Toggle theme"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);

  await activate(page.getByTitle("Settings").last());
  const settings = page.getByTestId("settings-view");
  await expectInsideViewport(page, settings);
  await expect(settings.locator("nav button")).toHaveCount(9);
  await activate(settings.getByRole("button", { name: "Appearance" }));
  await expect(settings.getByText("Interface scale")).toBeVisible();
  await activate(settings.getByTitle("Back to workspace"));
  await expect(settings).toBeHidden();

  await activate(page.getByLabel("Hide", { exact: true }));
  await expect(page.getByLabel("Show", { exact: true })).toBeVisible();
  await activate(page.getByLabel("Show", { exact: true }));
  await expect(page.getByTestId("new-conversation-chatgpt")).toBeVisible();
});

test("persists appearance settings and keeps disabled-provider history usable", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  await activate(page.getByTitle("Settings").last());
  const settings = page.getByTestId("settings-view");
  await activate(settings.getByRole("button", { name: "Appearance" }));
  await settings.getByText("Interface scale").locator("..").getByRole("combobox")
    .selectOption("1.1");
  await settings.getByText("Density").locator("..").getByRole("combobox")
    .selectOption("compact");
  await settings.getByText("Contrast").locator("..").getByRole("combobox")
    .selectOption("high");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");

  await activate(settings.getByRole("button", { name: "Providers & sync" }));
  await activate(settings.getByRole("switch", {
    name: "Use for new chats ChatGPT",
  }));
  await activate(settings.getByTitle("Back to workspace"));
  await expect(page.getByTestId("chat-view")).toBeVisible();

  await page.getByTestId("composer-input").fill("disabled history remains usable");
  await activate(page.getByTestId("send-message"));
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
    "Mock ChatGPT reply: disabled history remains usable",
  );

  await activate(page.getByTestId("open-comparison"));
  await expect(page.getByTestId("comparison-modal").getByText("ChatGPT")).toHaveCount(0);
  await dispatchKey(page, "Escape");

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const value = await window.aihub.getSettings();
        return {
          uiScale: value.uiScale,
          density: value.density,
          contrastMode: value.contrastMode,
          defaultProvider: value.defaultProvider,
          enabledProviders: value.enabledProviders,
        };
      }),
    )
    .toEqual({
      uiScale: 1.1,
      density: "compact",
      contrastMode: "high",
      defaultProvider: "claude",
      enabledProviders: [
        "claude",
        "doubao",
        "kimi",
        "deepseek",
        "hunyuan",
        "qianwen",
      ],
    });
});

test("does not execute a destructive action when confirmation is canceled", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  const conversation = page.locator('[data-testid^="conversation-item-"]').first();
  await openContextMenu(conversation);
  await activate(page.getByRole("button", { name: "Delete" }).last());
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("move to Trash");
  await activate(confirmation.getByRole("button", { name: "Cancel" }));
  await expect(conversation).toBeVisible();
});

test("moves a conversation to Trash, restores it, and creates a verified backup", async ({
  page,
}) => {
  await completeOnboarding(page);
  await createChat(page);

  const conversation = page.locator('[data-testid^="conversation-item-"]').first();
  await openContextMenu(conversation);
  await activate(page.getByRole("button", { name: "Delete" }).last());
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("move to Trash");
  await activate(confirmation.getByRole("button", { name: "Delete" }));
  await expect(conversation).toBeHidden();

  await activate(page.getByTitle("Settings").last());
  const settings = page.getByTestId("settings-view");
  await activate(settings.getByRole("button", { name: "Data & privacy" }));
  await expect(
    settings.getByText("New ChatGPT conversation", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByText(/Automatic cleanup:/)).toBeVisible();
  await activate(settings.getByRole("button", { name: "Restore", exact: true }));
  await expect(settings.getByText("Trash is empty")).toBeVisible();

  await activate(settings.getByRole("button", { name: "Back up now" }));
  await expect(
    settings.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await expect(settings.getByText("Manual", { exact: false })).toBeVisible();

  await activate(settings.getByTitle("Back to workspace"));
  await expect(conversation).toBeVisible();
});

test("switches the complete settings navigation between English and Chinese", async ({ page }) => {
  await completeOnboarding(page);
  await activate(page.getByTitle("Settings").last());
  const settings = page.getByTestId("settings-view");

  await settings.getByText("Language").locator("..").getByRole("combobox")
    .selectOption("zh-CN");
  await expect(settings.locator("nav button")).toHaveText([
    "通用",
    "外观",
    "Provider 与同步",
    "会话与组织",
    "系统提示词",
    "知识库",
    "快捷键",
    "数据与隐私",
    "关于",
  ]);

  await settings.getByText("界面语言").locator("..").getByRole("combobox")
    .selectOption("en-US");
  await expect(settings.locator("nav button")).toHaveText([
    "General",
    "Appearance",
    "Providers & sync",
    "Conversations & organization",
    "System prompts",
    "Knowledge",
    "Shortcuts",
    "Data & privacy",
    "About",
  ]);
});

test("exports a valid privacy-filtered V1 data file", async ({
  page,
  electronApp,
  testUserData,
}) => {
  await completeOnboarding(page);
  await createChat(page);
  const exportPath = path.join(testUserData, "e2e-aihub-data.json");
  await electronApp.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: target,
    });
  }, exportPath);

  await activate(page.getByTitle("Settings").last());
  const settings = page.getByTestId("settings-view");
  await activate(settings.getByRole("button", { name: "Data & privacy" }));
  await activate(settings.getByRole("button", { name: "Export all conversations" }));

  let exported = "";
  await expect.poll(async () => {
    exported = await readFile(exportPath, "utf8").catch(() => "");
    return exported.length;
  }).toBeGreaterThan(0);
  const payload = JSON.parse(exported) as {
    format: string;
    version: number;
    conversations: unknown[];
  };
  expect(payload).toMatchObject({
    format: "aihub-data",
    version: 1,
  });
  expect(payload.conversations.length).toBeGreaterThan(0);
  expect(exported).not.toContain("localPath");
  expect(exported).not.toContain("providerApiConfigs");
  expect(exported).not.toContain("cookie");

  await electronApp.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
  }, exportPath);
  await activate(settings.getByRole("button", { name: "Import all conversations" }));
  const importPreview = page.getByRole("dialog");
  await expect(importPreview).toContainText("e2e-aihub-data.json");
  await expect(importPreview).toContainText("Conflicts (will be skipped)");
  await expect(importPreview).toContainText(
    "merge mode and never overwrites existing records",
  );
  await activate(importPreview.getByRole("button", { name: "Confirm" }));
  await expect(importPreview).toBeHidden();
  await expect(page.getByText(/Imported 0 conversations and 0 messages/))
    .toBeVisible();
});

test("renders provider failures and allows the same UI to recover", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  await page.getByTestId("composer-input").fill("[mock:fail] exercise failure UI");
  await activate(page.getByTestId("send-message"));
  await expect(page.getByTestId("composer-input")).toHaveValue("");
  await page.getByTestId("composer-input").fill("newer draft stays intact");
  const failedAssistant = page.locator(
    '[data-message-role="assistant"][data-message-status="failed"]',
  );
  await expect(failedAssistant).toBeVisible();
  await expect(
    failedAssistant.getByLabel("Retry", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("composer-input")).toHaveValue(
    "newer draft stays intact",
  );

  await page.getByTestId("composer-input").fill("recovery succeeds");
  await activate(page.getByTestId("send-message"));
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
    "Mock ChatGPT reply: recovery succeeds",
  );
  await expect(page.locator('[data-message-role="assistant"]').last()).toHaveAttribute(
    "data-message-status",
    "completed",
  );
});

test("cancels a slow mock generation through the visible stop control", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  await page.getByTestId("composer-input").fill("[mock:slow] cancel this response");
  await activate(page.getByTestId("send-message"));
  await activate(page.getByTestId("stop-generation"));
  const assistant = page.locator('[data-message-role="assistant"]').last();
  await expect(assistant).toHaveAttribute("data-message-status", "failed");
  await expect(page.getByTestId("send-message")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeEditable();
});

test("opens and closes the mock provider drawer without covering the workspace", async ({ page, electronApp }) => {
  await completeOnboarding(page);
  await createChat(page);

  const shell = page.getByTestId("app-shell");
  const chat = page.getByTestId("chat-view");
  const initialChatWidth = (await chat.boundingBox())!.width;
  await activate(page.getByTitle("Open provider page"));
  await expect
    .poll(() => inlineDrawerColumnWidth(page))
    .toBeGreaterThanOrEqual(320);
  await expect
    .poll(() => nativeProviderDrawerWidth(electronApp))
    .toBeGreaterThanOrEqual(320);
  const openChatWidth = (await chat.boundingBox())!.width;
  expect(openChatWidth).toBeLessThan(initialChatWidth);
  await expectInsideViewport(page, shell);

  const handle = page.getByTestId("provider-resize-handle");
  await dispatchInputKey(handle, "ArrowLeft");
  await expect
    .poll(() => page.evaluate(async () =>
      (await window.aihub.getSettings()).providerSplitRatio,
    ))
    .toBeGreaterThan(0.42);

  await activate(page.getByLabel("Hide LLM Workbench client"));
  await expect(shell).toHaveAttribute("data-pane-layout", "provider-only");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await activate(page.getByLabel("Show LLM Workbench client"));
  await expect(shell).toHaveAttribute("data-pane-layout", "split");

  await activate(page.getByLabel("Hide provider website"));
  await expect
    .poll(() => inlineDrawerColumnWidth(page))
    .toBe(0);
  await expect.poll(() => nativeProviderDrawerWidth(electronApp)).toBe(0);
  await activate(page.getByTestId("restore-provider-pane"));
  await expect(shell).toHaveAttribute("data-pane-layout", "split");
});

test("auto-resizes the composer and switches to one pane on narrow windows", async ({ page }) => {
  await completeOnboarding(page);
  await createChat(page);

  const composer = page.getByTestId("composer-input");
  const initialHeight = (await composer.boundingBox())!.height;
  await composer.fill(Array.from({ length: 18 }, (_, index) => `line ${index}`).join("\n"));
  const expandedHeight = (await composer.boundingBox())!.height;
  expect(expandedHeight).toBeGreaterThan(initialHeight);
  await composer.fill("short");
  expect((await composer.boundingBox())!.height).toBeLessThan(expandedHeight);

  await activate(page.getByTitle("Open provider page"));
  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-pane-layout",
    "split",
  );
  await page.setViewportSize({ width: 960, height: 821 });
  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-pane-layout",
    "provider-only",
  );
  await activate(page.getByRole("button", { name: "LLM Workbench", exact: true }));
  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-pane-layout",
    "client-only",
  );
  await page.setViewportSize({ width: 1281, height: 821 });
  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-pane-layout",
    "split",
  );
});

test("rejects synthetic provider events while accepting LLM Workbench trusted input", async ({ page, electronApp }) => {
  await completeOnboarding(page);
  await createChat(page);
  await activate(page.getByTitle("Open provider page"));

  const syntheticResult = await electronApp.evaluate(async ({ webContents }) => {
    const provider = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith("data:text/html"));
    if (!provider) throw new Error("Mock provider webContents was not found.");
    return provider.executeJavaScript(`(() => {
      const composer = document.querySelector('#fixture-composer');
      const submit = document.querySelector('#fixture-submit');
      composer.value = 'synthetic attempt';
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'synthetic attempt',
        inputType: 'insertText',
      }));
      submit.click();
      return {
        accepted: globalThis.__mockTrustedAccepted,
        status: document.querySelector('#status').textContent,
      };
    })()`);
  });
  expect(syntheticResult).toEqual({
    accepted: false,
    status: "untrusted submit rejected",
  });

  await activate(page.getByTitle("Open provider page"));
  await page.getByTestId("composer-input").fill("trusted fixture succeeds");
  await activate(page.getByTestId("send-message"));
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
    "Mock ChatGPT reply: trusted fixture succeeds",
  );
});

test("creates a comparison and displays independent mock replies", async ({ page }) => {
  await completeOnboarding(page);
  await activate(page.getByTestId("open-comparison"));
  const modal = page.getByTestId("comparison-modal");
  await expect(modal).toBeVisible();
  await activate(modal.getByTestId("start-comparison"));
  const comparison = page.getByTestId("comparison-view");
  await expect(comparison).toBeVisible();

  const composer = comparison.getByPlaceholder(
    "Send the same prompt to every provider",
  );
  await composer.fill("compare autonomous output");
  await dispatchInputKey(composer, "Enter");
  await expect(comparison.getByText("Mock ChatGPT reply: compare autonomous output")).toBeVisible();
  await expect(comparison.getByText("Mock Claude reply: compare autonomous output")).toBeVisible();
});

async function inlineDrawerColumnWidth(page: import("@playwright/test").Page): Promise<number> {
  return page.getByTestId("app-shell").evaluate((element) => {
    const match = element.style.gridTemplateColumns.match(/([0-9.]+)px$/);
    return Number.parseFloat(match?.[1] ?? "0");
  });
}

async function nativeProviderDrawerWidth(
  electronApp: import("@playwright/test").ElectronApplication,
): Promise<number> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return 0;
    const [contentWidth = 0] = window.getContentSize();
    const visibleDrawer = window.contentView.children
      .map((view) => view.getBounds())
      .find((entry) => entry.width >= 320 && entry.x < contentWidth);
    return visibleDrawer?.width ?? 0;
  });
}
