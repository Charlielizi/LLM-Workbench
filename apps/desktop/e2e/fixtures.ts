import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { ProviderId } from "@aihub/core";
import { AppDatabase } from "../src/main/database";

interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  testUserData: string;
  historyFixtureProvider: ProviderId | null;
}

const require = createRequire(path.join(process.cwd(), "playwright.config.ts"));

export const test = base.extend<ElectronFixtures>({
  historyFixtureProvider: [null, { option: true }],

  testUserData: async ({}, use) => {
    const testUserData = await mkdtemp(
      path.join(os.tmpdir(), "aihub-e2e-"),
    );
    try {
      await use(testUserData);
    } finally {
      await removeTestUserData(testUserData);
    }
  },

  electronApp: async ({
    historyFixtureProvider,
    testUserData,
  }, use, testInfo) => {
    if (historyFixtureProvider) {
      seedHistoryDatabase(testUserData, historyFixtureProvider);
    }
    seedTestLocale(testUserData);
    let electronApp: ElectronApplication;
    try {
      electronApp = await launchTestElectron(
        testUserData,
        historyFixtureProvider,
        `test-${testInfo.parallelIndex}-${testInfo.retry}`,
      );
    } catch (firstError) {
      await attachBootstrapDiagnostics(
        testInfo,
        testUserData,
        "electron-bootstrap-first-attempt",
      );
      const failedRuntimePid = terminateRuntimeFromUserData(testUserData);
      if (failedRuntimePid) await waitForPidExit(failedRuntimePid, 2_000);
      if (historyFixtureProvider) {
        await resetHistoryDatabase(testUserData, historyFixtureProvider);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        electronApp = await launchTestElectron(
          testUserData,
          historyFixtureProvider,
          `test-${testInfo.parallelIndex}-${testInfo.retry}-restart`,
        );
      } catch (retryError) {
        await attachBootstrapDiagnostics(testInfo, testUserData);
        terminateRuntimeFromUserData(testUserData);
        throw new AggregateError(
          [firstError, retryError],
          "Electron failed to launch after one controlled restart.",
        );
      }
    }
    const electronProcess = electronApp.process();
    const runtimePid = readRuntimePid(testUserData);
    try {
      await use(electronApp);
    } finally {
      await electronApp.close().catch(() => undefined);
      await waitForExit(electronProcess, 5_000);
      if (runtimePid) {
        await waitForPidExit(runtimePid, 5_000);
      }
      if (runtimePid && isProcessRunning(runtimePid)) {
        terminateProcessTree(runtimePid);
        await waitForPidExit(runtimePid, 2_000);
      }
      if (
        electronProcess.exitCode === null &&
        electronProcess.pid &&
        electronProcess.pid !== runtimePid
      ) {
        terminateProcessTree(electronProcess.pid);
        await waitForExit(electronProcess, 2_000);
      }
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachBootstrapDiagnostics(testInfo, testUserData);
      }
    }
  },

  page: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow({ timeout: 15_000 });
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await page.bringToFront();
    await page.setViewportSize({ width: 1281, height: 821 });
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await page.evaluate(() => {
      const windowErrors: string[] = [];
      (globalThis as typeof globalThis & { __aihubE2EWindowErrors?: string[] })
        .__aihubE2EWindowErrors = windowErrors;
      window.addEventListener("error", (event) => {
        windowErrors.push([
          event.message,
          event.filename,
          String(event.lineno),
          event.error instanceof Error ? event.error.stack ?? event.error.message : "",
        ].join(" | "));
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        windowErrors.push(
          `unhandledrejection | ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`,
        );
      });
    });
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      runtimeErrors.push(`pageerror: ${error.stack ?? error.message}`);
    });
    page.on("crash", () => {
      runtimeErrors.push("renderer crashed");
    });
    await page.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    try {
      await use(page);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) {
        const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
        if (screenshot) {
          await testInfo.attach("failure", {
            body: screenshot,
            contentType: "image/png",
          });
        }
        await page.context().tracing.stop({
          path: testInfo.outputPath("trace.zip"),
        });
      } else {
        await page.context().tracing.stop();
      }
      if (runtimeErrors.length > 0) {
        await testInfo.attach("runtime-errors", {
          body: Buffer.from(runtimeErrors.join("\n\n"), "utf8"),
          contentType: "text/plain",
        });
      }
      const windowErrors = await page.evaluate(() =>
        (globalThis as typeof globalThis & {
          __aihubE2EWindowErrors?: string[];
        }).__aihubE2EWindowErrors ?? [],
      ).catch(() => []);
      if (windowErrors.length > 0) {
        await testInfo.attach("window-errors", {
          body: Buffer.from(windowErrors.join("\n\n"), "utf8"),
          contentType: "text/plain",
        });
      }
      expect(runtimeErrors, "Electron runtime errors").toEqual([]);
    }
  },
});

export { expect } from "@playwright/test";

export async function launchTestElectron(
  testUserData: string,
  historyFixtureProvider: ProviderId | null,
  runId: string,
): Promise<ElectronApplication> {
  const packagedExecutable = process.env.AIHUB_E2E_PACKAGED_EXE?.trim();
  const mainPath = path.resolve(process.cwd(), ".vite/build/main.js");
  if (packagedExecutable && !existsSync(packagedExecutable)) {
    throw new Error(
      `Packaged Electron executable is missing at ${packagedExecutable}.`,
    );
  }
  if (!packagedExecutable && !existsSync(mainPath)) {
    throw new Error(
      `Electron test build is missing at ${mainPath}. Run the desktop build first.`,
    );
  }
  const electronExecutable =
    packagedExecutable ?? (require("electron") as string);
  return electron.launch({
    executablePath: electronExecutable,
    args: [
      `--user-data-dir=${testUserData}`,
      ...(packagedExecutable ? [] : [mainPath]),
    ],
    env: {
      ...process.env,
      AIHUB_TEST_MODE: "1",
      AIHUB_TEST_USER_DATA: testUserData,
      AIHUB_AI_RUN_ID: runId,
      ...(historyFixtureProvider
        ? {
            AIHUB_TEST_AUTO_SYNC: "1",
            AIHUB_TEST_HISTORY_FIXTURE: historyFixtureProvider,
          }
        : {}),
    },
    timeout: process.env.CI ? 60_000 : 20_000,
  });
}

function waitForExit(
  child: ReturnType<ElectronApplication["process"]>,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync(
      "taskkill.exe",
      ["/pid", String(pid), "/t", "/f"],
      { windowsHide: true, stdio: "ignore" },
    );
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The test process already exited.
  }
}

function terminateRuntimeFromUserData(testUserData: string): number | undefined {
  const runtimePid = readRuntimePid(testUserData);
  if (runtimePid) terminateProcessTree(runtimePid);
  return runtimePid;
}

function readRuntimePid(testUserData: string): number | undefined {
  const runtimeInfoPath = path.join(
    testUserData,
    "diagnostics",
    "runtime-info.json",
  );
  try {
    const runtimeInfo = JSON.parse(
      readFileSync(runtimeInfoPath, "utf8"),
    ) as { pid?: unknown };
    if (
      typeof runtimeInfo.pid === "number" &&
      Number.isInteger(runtimeInfo.pid) &&
      runtimeInfo.pid > 0
    ) {
      return runtimeInfo.pid;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function attachBootstrapDiagnostics(
  testInfo: import("@playwright/test").TestInfo,
  testUserData: string,
  attachmentName = "electron-bootstrap",
): Promise<void> {
  const bootstrapPath = path.join(
    testUserData,
    "diagnostics",
    "bootstrap.log",
  );
  const runtimeInfoPath = path.join(
    testUserData,
    "diagnostics",
    "runtime-info.json",
  );
  const [bootstrap, runtimeInfo] = await Promise.all([
    readFile(bootstrapPath, "utf8").catch(() => "bootstrap.log was not written"),
    readFile(runtimeInfoPath, "utf8").catch(
      () => "runtime-info.json was not written",
    ),
  ]);
  await testInfo.attach(attachmentName, {
    body: Buffer.from([
      `userData=${testUserData}`,
      "",
      bootstrap,
      "",
      runtimeInfo,
    ].join("\n"), "utf8"),
    contentType: "text/plain",
  });
}

async function removeTestUserData(testUserData: string): Promise<void> {
  if (
    path.basename(testUserData).startsWith("aihub-e2e-") &&
    path.dirname(testUserData) === os.tmpdir()
  ) {
    await rm(testUserData, { recursive: true, force: true });
  }
}

function seedHistoryDatabase(
  testUserData: string,
  historyFixtureProvider: ProviderId,
): void {
  const database = new AppDatabase(path.join(testUserData, "aihub.sqlite"));
  try {
    database.setSettings({
      autoSyncWebHistory: true,
      hasCompletedOnboarding: true,
      providerBackends: {
        chatgpt: historyFixtureProvider === "chatgpt" ? "web" : "manual",
        claude: historyFixtureProvider === "claude" ? "web" : "manual",
        doubao: historyFixtureProvider === "doubao" ? "web" : "manual",
        kimi: historyFixtureProvider === "kimi" ? "web" : "manual",
        deepseek: historyFixtureProvider === "deepseek" ? "web" : "manual",
        hunyuan: historyFixtureProvider === "hunyuan" ? "web" : "manual",
        qianwen: historyFixtureProvider === "qianwen" ? "web" : "manual",
      },
    });
    database.createConversation({
      id: "local-before-auto-sync",
      title: "Local conversation before auto sync",
      provider: historyFixtureProvider,
    });
  } finally {
    database.close();
  }
}

async function resetHistoryDatabase(
  testUserData: string,
  historyFixtureProvider: ProviderId,
): Promise<void> {
  const databasePath = path.join(testUserData, "aihub.sqlite");
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ]);
  seedHistoryDatabase(testUserData, historyFixtureProvider);
  seedTestLocale(testUserData);
}

function seedTestLocale(testUserData: string): void {
  const database = new AppDatabase(path.join(testUserData, "aihub.sqlite"));
  try {
    database.setSettings({
      ...database.getSettings(),
      theme: "light",
      locale: "en-US",
      motion: "reduced",
    });
  } finally {
    database.close();
  }
}
