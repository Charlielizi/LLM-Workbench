import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog } from "electron";
import started from "electron-squirrel-startup";
import { PROVIDER_IDS, type ProviderId } from "@aihub/core";
import { AppService } from "./app-service";
import { AppDatabase } from "./database";
import { registerIpc } from "./ipc";

if (started) app.quit();

installSafeConsole();

let mainWindow: BrowserWindow | undefined;
let service: AppService | undefined;
let database: AppDatabase | undefined;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "AIHub",
    show: false,
    backgroundColor: "#101218",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#a1a1aa",
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl) => {
      const detail = `${errorDescription} (${errorCode})\n${validatedUrl}`;
      console.error("Renderer failed to load:", detail);
      void dialog.showMessageBox(mainWindow!, {
        type: "error",
        title: "AIHub 启动失败",
        message: "统一界面未能加载。",
        detail,
      });
    },
  );

  database = new AppDatabase(path.join(app.getPath("userData"), "aihub.sqlite"));
  service = new AppService(mainWindow, database);
  registerIpc(service);
  mainWindow.on("resize", () => service?.layout());
  mainWindow.on("closed", () => {
    service?.destroy();
    database?.close();
    service = undefined;
    database = undefined;
    mainWindow = undefined;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }

  await service.initialize();
  await maybeRunProviderSmokeTest(service);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

function installSafeConsole(): void {
  for (const method of ["log", "info", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      try {
        original(...args);
      } catch (error) {
        if (!isBrokenPipe(error)) {
          throw error;
        }
      }
    };
  }
}

function isBrokenPipe(error: unknown): boolean {
  return error instanceof Error &&
    /EPIPE|broken pipe/i.test(error.message);
}

async function maybeRunProviderSmokeTest(
  appService: AppService,
): Promise<void> {
  const outputDir = path.join(app.getPath("userData"), "diagnostics");
  const requestPath = path.join(outputDir, "provider-smoke-request.json");
  const request = await readSmokeTestRequest(requestPath);
  const provider = request?.provider ??
    process.env.AIHUB_SMOKE_TEST_PROVIDER as ProviderId | undefined;
  if (!provider || !PROVIDER_IDS.includes(provider)) return;

  const token = `AIHUB_${provider.toUpperCase()}_${Date.now()}`;
  const outputPath = path.join(
    outputDir,
    `provider-smoke-${provider}.json`,
  );

  const writeResult = async (data: unknown) => {
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
  };

  try {
    if (request) {
      await unlink(requestPath).catch(() => undefined);
    }
    await writeResult({
      provider,
      token,
      stage: "started",
      startedAt: new Date().toISOString(),
    });
    await appService.setWebsiteVisible(provider, true);
    const conversation = await appService.createConversation(provider);
    const text = `${token}\nReturn exactly this token: ${token}`;
    let sendError: string | null = null;
    try {
      await appService.sendMessage({
        provider,
        conversationId: conversation.id,
        text,
      });
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const current = appService.snapshot().conversations.find(
        (item) => item.id === conversation.id,
      );
      const messages = current?.messages ?? [];
      const userMessage = messages.find((item) => item.role === "user");
      const assistantMessage = [...messages]
        .reverse()
        .find((item) => item.role === "assistant");
      if (assistantMessage?.status === "completed" || userMessage?.status === "failed") {
        await writeResult({
          provider,
          token,
          sendError,
          userMessage,
          assistantMessage,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const current = appService.snapshot().conversations.find(
      (item) => item.id === conversation.id,
    );
    await writeResult({
      provider,
      token,
      sendError,
      conversation: current,
      timeout: true,
    });
  } catch (error) {
    await writeResult({
      provider,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

async function readSmokeTestRequest(
  requestPath: string,
): Promise<{ provider: ProviderId } | undefined> {
  try {
    const raw = (await readFile(requestPath, "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as { provider?: unknown };
    if (
      typeof parsed.provider === "string" &&
      PROVIDER_IDS.includes(parsed.provider as ProviderId)
    ) {
      return { provider: parsed.provider as ProviderId };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
