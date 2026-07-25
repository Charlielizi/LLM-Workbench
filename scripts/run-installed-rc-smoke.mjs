import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "@playwright/test";

const executableArgument = process.argv.find((value) =>
  value.startsWith("--executable="),
);
const reportArgument = process.argv.find((value) =>
  value.startsWith("--report="),
);
const executablePath = path.resolve(
  executableArgument?.slice("--executable=".length) ??
    "C:/Users/li/AppData/Local/aihub/app-0.1.0-rc1/AIHub.exe",
);
const reportPath = reportArgument
  ? path.resolve(reportArgument.slice("--report=".length))
  : undefined;

if (!existsSync(executablePath)) {
  throw new Error(`Installed RC executable was not found: ${executablePath}`);
}

const userData = await mkdtemp(path.join(os.tmpdir(), "aihub-installed-smoke-"));
const result = {
  executablePath,
  userData,
  startedAt: new Date().toISOString(),
  localConversationId: undefined,
  remoteConversationCount: 0,
  remoteMessageCount: 0,
  prefetchedConversationCount: 0,
  settingsRoundTrip: false,
  passed: false,
};
let activeApp;
let activePage;

try {
  activeApp = await launchInstalled(false, "installed-local");
  let page = await activeApp.firstWindow({ timeout: 15_000 });
  activePage = page;
  await page.setViewportSize({ width: 1281, height: 821 });
  await page.waitForFunction(() => Boolean(window.aihub));

  const currentSettings = await page.evaluate(() => window.aihub.getSettings());
  await page.evaluate(
    (settings) => window.aihub.setSettings(settings),
    {
      ...currentSettings,
      locale: "en-US",
      hasCompletedOnboarding: true,
      autoSyncWebHistory: true,
      providerBackends: {
        chatgpt: "web",
        claude: "manual",
        doubao: "manual",
        kimi: "manual",
        deepseek: "manual",
        hunyuan: "manual",
        qianwen: "manual",
      },
    },
  );
  const storedSettings = await page.evaluate(() => window.aihub.getSettings());
  assert(storedSettings.locale === "en-US", "Settings locale did not persist.");
  assert(
    storedSettings.hasCompletedOnboarding === true,
    "Onboarding setting did not persist.",
  );
  result.settingsRoundTrip = true;

  const localConversation = await page.evaluate(
    () => window.aihub.createConversation("chatgpt"),
  );
  result.localConversationId = localConversation.id;
  await page.evaluate(
    (conversationId) =>
      window.aihub.sendMessage({
        provider: "chatgpt",
        conversationId,
        text: "installed RC smoke",
      }),
    localConversation.id,
  );
  await poll(async () => {
    const snapshot = await page.evaluate(() => window.aihub.getSnapshot());
    const conversation = snapshot.conversations.find(
      (item) => item.id === localConversation.id,
    );
    return conversation?.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.status === "completed" &&
        message.content.some(
          (block) =>
            block.type === "text" &&
            block.text.includes("Mock ChatGPT reply: installed RC smoke"),
        ),
    );
  }, 15_000, "Installed Mock send did not complete.");

  await closeInstalled(activeApp, userData);
  activeApp = await launchInstalled(true, "installed-auto-sync");
  page = await activeApp.firstWindow({ timeout: 15_000 });
  activePage = page;
  await page.waitForFunction(() => Boolean(window.aihub));
  const initialRestartSnapshot = await page.evaluate(
    () => window.aihub.getSnapshot(),
  );
  assert(
    initialRestartSnapshot.conversations.some(
      (conversation) => conversation.id === localConversation.id,
    ),
    "The local conversation was not restored before installed auto-sync.",
  );

  await poll(async () => {
    const snapshot = await page.evaluate(() => window.aihub.getSnapshot());
    return remoteHistory(snapshot).length === 12;
  }, 20_000, "Installed auto-sync did not import 12 remote conversations.");
  let synchronizedSnapshot = await page.evaluate(
    () => window.aihub.getSnapshot(),
  );
  await poll(async () => {
    synchronizedSnapshot = await page.evaluate(
      () => window.aihub.getSnapshot(),
    );
    return remoteHistory(synchronizedSnapshot).filter(
      (conversation) => conversation.messages.length === 2,
    ).length === 11;
  }, 20_000, "Installed auto-sync did not prefetch 11 conversations.");
  result.prefetchedConversationCount = 11;

  const lazyConversation = synchronizedSnapshot.conversations.find(
    (conversation) => conversation.title === "Remote history 11",
  );
  assert(lazyConversation, "Lazy remote conversation was not found.");
  await page.evaluate(
    (conversationId) => window.aihub.selectConversation(conversationId),
    lazyConversation.id,
  );
  await poll(async () => {
    const snapshot = await page.evaluate(() => window.aihub.getSnapshot());
    return snapshot.conversations.find(
      (conversation) => conversation.id === lazyConversation.id,
    )?.messages.length === 2;
  }, 10_000, "Installed lazy conversation body was not synchronized.");

  synchronizedSnapshot = await page.evaluate(() => window.aihub.getSnapshot());
  result.remoteConversationCount = remoteHistory(synchronizedSnapshot).length;
  result.remoteMessageCount = remoteHistory(synchronizedSnapshot).reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );
  assert(result.remoteConversationCount === 12, "Remote count changed.");
  assert(result.remoteMessageCount === 24, "Remote messages were incomplete.");

  await closeInstalled(activeApp, userData);
  activeApp = await launchInstalled(true, "installed-idempotency");
  page = await activeApp.firstWindow({ timeout: 15_000 });
  activePage = page;
  await page.waitForFunction(() => Boolean(window.aihub));
  await poll(async () => {
    const snapshot = await page.evaluate(() => window.aihub.getSnapshot());
    return remoteHistory(snapshot).length === 12;
  }, 20_000, "Installed restart did not restore remote history.");
  const finalSnapshot = await page.evaluate(() => window.aihub.getSnapshot());
  const finalRemote = remoteHistory(finalSnapshot);
  assert(finalRemote.length === 12, "Installed restart duplicated conversations.");
  assert(
    finalRemote.reduce(
      (total, conversation) => total + conversation.messages.length,
      0,
    ) === 24,
    "Installed restart duplicated or lost messages.",
  );
  result.passed = true;
} catch (error) {
  result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  result.failureSnapshot = await activePage
    ?.evaluate(() => window.aihub.getSnapshot())
    .catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (activeApp) await closeInstalled(activeApp, userData);
  if (
    path.basename(userData).startsWith("aihub-installed-smoke-") &&
    path.dirname(userData) === os.tmpdir()
  ) {
    await rm(userData, { recursive: true, force: true });
  }
}

result.completedAt = new Date().toISOString();
if (reportPath) {
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(`AIHUB_INSTALLED_SMOKE_RESULT=${JSON.stringify(result)}`);

async function launchInstalled(autoSync, runId) {
  try {
    return await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userData}`, "--lang=en-US"],
      env: {
        ...process.env,
        AIHUB_TEST_MODE: "1",
        AIHUB_TEST_USER_DATA: userData,
        AIHUB_AI_RUN_ID: runId,
        ...(autoSync
          ? {
              AIHUB_TEST_AUTO_SYNC: "1",
              AIHUB_TEST_HISTORY_FIXTURE: "chatgpt",
            }
          : {}),
      },
      timeout: 20_000,
    });
  } catch (firstError) {
    terminateRuntime(userData);
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userData}`, "--lang=en-US"],
        env: {
          ...process.env,
          AIHUB_TEST_MODE: "1",
          AIHUB_TEST_USER_DATA: userData,
          AIHUB_AI_RUN_ID: `${runId}-restart`,
          ...(autoSync
            ? {
                AIHUB_TEST_AUTO_SYNC: "1",
                AIHUB_TEST_HISTORY_FIXTURE: "chatgpt",
              }
            : {}),
        },
        timeout: 20_000,
      });
    } catch (retryError) {
      terminateRuntime(userData);
      throw new AggregateError(
        [firstError, retryError],
        "Installed RC failed to launch after one controlled restart.",
      );
    }
  }
}

async function closeInstalled(app, dataDir) {
  const child = app.process();
  await app.close().catch(() => undefined);
  await waitForExit(child, 5_000);
  const runtimePid = readRuntimePid(dataDir);
  if (runtimePid && isProcessRunning(runtimePid)) {
    terminateProcessTree(runtimePid);
  }
  if (
    child.exitCode === null &&
    child.pid &&
    child.pid !== runtimePid
  ) {
    terminateProcessTree(child.pid);
  }
}

function remoteHistory(snapshot) {
  return snapshot.conversations.filter((conversation) =>
    conversation.title.startsWith("Remote history "),
  );
}

async function poll(operation, timeoutMs, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failureMessage);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function terminateRuntime(dataDir) {
  const runtimePid = readRuntimePid(dataDir);
  if (runtimePid) terminateProcessTree(runtimePid);
}

function readRuntimePid(dataDir) {
  try {
    const raw = readFileSync(
      path.join(dataDir, "diagnostics", "runtime-info.json"),
      "utf8",
    );
    const runtime = JSON.parse(raw);
    return Number.isInteger(runtime.pid) && runtime.pid > 0
      ? runtime.pid
      : undefined;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}
