import path from "node:path";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog } from "electron";
import started from "electron-squirrel-startup";
import { AppService } from "./app-service";
import { AppDatabase } from "./database";
import { registerIpc } from "./ipc";
import { readProviderSmokeRequest, runProviderSmokeTest } from "./provider-smoke";

if (started) app.quit();

configureTestUserData();
configureRemoteDebugging();

installSafeConsole();

const runtimeInfo = {
  instanceId: crypto.randomUUID(),
  pid: process.pid,
  startedAt: new Date().toISOString(),
};

const hasSingleInstanceLock =
  process.env.AIHUB_TEST_MODE === "1" || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
let service: AppService | undefined;
let database: AppDatabase | undefined;
let bootstrapLogPath: string | undefined;
let runtimeInfoPath: string | undefined;
let smokeMonitorTimer: ReturnType<typeof setInterval> | undefined;
let smokeMonitorRunning = false;

function configureRemoteDebugging(): void {
  const rawPort = process.env.AIHUB_CDP_PORT;
  if (!rawPort) return;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("AIHUB_CDP_PORT must be an integer from 1024 to 65535.");
  }
  app.commandLine.appendSwitch("remote-debugging-port", String(port));
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}

async function createWindow(): Promise<void> {
  const userDataDir = app.getPath("userData");
  bootstrapLogPath = path.join(userDataDir, "diagnostics", "bootstrap.log");
  runtimeInfoPath = path.join(userDataDir, "diagnostics", "runtime-info.json");
  await writeRuntimeInfo();
  await logBootstrap(
    `runtime:start instance=${runtimeInfo.instanceId} pid=${runtimeInfo.pid} startedAt=${runtimeInfo.startedAt}`,
  );
  await logBootstrap(`createWindow:start userData=${userDataDir}`);
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
        title: app.getLocale().toLowerCase().startsWith("zh")
          ? "AIHub 启动失败"
          : "AIHub failed to start",
        message: app.getLocale().toLowerCase().startsWith("zh")
          ? "统一界面未能加载。"
          : "The unified interface could not be loaded.",
        detail,
      });
    },
  );

  database = new AppDatabase(path.join(app.getPath("userData"), "aihub.sqlite"));
  await logBootstrap(`database:opened path=${path.join(app.getPath("userData"), "aihub.sqlite")}`);
  service = new AppService(mainWindow, database, userDataDir);
  registerIpc(service);
  mainWindow.on("resize", () => service?.layout());
  mainWindow.on("closed", () => {
    stopProviderSmokeMonitor();
    service?.destroy();
    database?.close();
    service = undefined;
    database = undefined;
    mainWindow = undefined;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    await logBootstrap(`renderer:loaded url=${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
  } else {
    await mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
    await logBootstrap("renderer:loaded packaged file");
  }

  await logBootstrap("service:initialize:start");
  await service.initialize();
  await logBootstrap("service:initialize:done");
  startProviderSmokeMonitor();
}

function configureTestUserData(): void {
  if (process.env.AIHUB_TEST_MODE !== "1") return;
  const testUserData = process.env.AIHUB_TEST_USER_DATA;
  if (!testUserData || !path.isAbsolute(testUserData)) {
    throw new Error("AIHUB_TEST_USER_DATA must be an absolute path in test mode.");
  }
  app.setPath("userData", testUserData);
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(createWindow);
}

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

async function logBootstrap(message: string): Promise<void> {
  if (!bootstrapLogPath) return;
  try {
    await mkdir(path.dirname(bootstrapLogPath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await appendFile(bootstrapLogPath, line, "utf8");
  } catch {
    // Ignore bootstrap log errors
  }
}

async function writeRuntimeInfo(): Promise<void> {
  if (!runtimeInfoPath) return;
  try {
    await mkdir(path.dirname(runtimeInfoPath), { recursive: true });
    await writeFile(runtimeInfoPath, JSON.stringify(runtimeInfo, null, 2), "utf8");
  } catch {
    // Ignore runtime metadata write errors
  }
}

function startProviderSmokeMonitor(): void {
  if (smokeMonitorTimer) return;
  smokeMonitorTimer = setInterval(() => {
    void pollProviderSmokeRequest();
  }, 2_000);
  void pollProviderSmokeRequest();
}

function stopProviderSmokeMonitor(): void {
  if (!smokeMonitorTimer) return;
  clearInterval(smokeMonitorTimer);
  smokeMonitorTimer = undefined;
}

async function pollProviderSmokeRequest(): Promise<void> {
  if (smokeMonitorRunning || !service) return;
  const userDataDir = app.getPath("userData");
  const request = await readProviderSmokeRequest(
    path.join(userDataDir, "diagnostics", "provider-smoke-request.json"),
  );
  if (!request) return;
  if (
    request.targetRuntimeInstanceId &&
    request.targetRuntimeInstanceId !== runtimeInfo.instanceId
  ) {
    return;
  }

  smokeMonitorRunning = true;
  await logBootstrap("provider-smoke:start");
  try {
    await runProviderSmokeTest(service, userDataDir, undefined, {
      runtime: runtimeInfo,
      log: (message) => logBootstrap(message),
    });
  } finally {
    await logBootstrap("provider-smoke:done");
    smokeMonitorRunning = false;
  }
}
