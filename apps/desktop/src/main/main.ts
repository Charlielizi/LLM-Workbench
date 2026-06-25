import path from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import started from "electron-squirrel-startup";
import { AppService } from "./app-service";
import { AppDatabase } from "./database";
import { registerIpc } from "./ipc";

if (started) app.quit();

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
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
