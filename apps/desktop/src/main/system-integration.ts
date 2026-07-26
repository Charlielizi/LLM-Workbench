import {
  app,
  Menu,
  nativeImage,
  Notification,
  Tray,
  type BrowserWindow,
  type Event,
} from "electron";
import {
  DEFAULT_APP_SETTINGS,
  PROVIDER_LABELS,
  normalizeAppSettings,
  type AppSettingsPayload,
  type NormalizedAppSettings,
  type ProviderId,
} from "@aihub/core";

export type AppNotificationKind =
  | "generation-completed"
  | "generation-failed"
  | "sync-failed";

export interface AppNotification {
  kind: AppNotificationKind;
  provider: ProviderId;
  conversationId?: string;
  preview?: string;
}

export class SystemIntegration {
  private tray?: Tray;
  private settings: NormalizedAppSettings = normalizeAppSettings(
    DEFAULT_APP_SETTINGS,
  );
  private quitting = false;
  private lastNotifiedUpdateVersion?: string;

  constructor(
    private readonly window: BrowserWindow,
    private readonly openConversation: (conversationId: string) => void,
  ) {}

  apply(settings: AppSettingsPayload): void {
    this.settings = normalizeAppSettings(settings, this.settings);
    app.setLoginItemSettings({
      openAtLogin: this.settings.launchAtLogin,
    });
    if (this.settings.trayEnabled) this.ensureTray();
    else this.destroyTray();
  }

  handleWindowClose(event: Event): void {
    if (
      this.quitting ||
      !this.settings.trayEnabled ||
      this.settings.closeBehavior !== "minimize-to-tray"
    ) {
      return;
    }
    event.preventDefault();
    this.window.hide();
  }

  notify(notification: AppNotification): void {
    if (!Notification.isSupported()) return;
    if (this.window.isVisible() && this.window.isFocused()) return;
    const preferences = this.settings.notificationPreferences;
    if (
      (notification.kind === "generation-completed" &&
        !preferences.generationCompleted) ||
      (notification.kind === "generation-failed" &&
        !preferences.generationFailed) ||
      (notification.kind === "sync-failed" && !preferences.syncFailed)
    ) {
      return;
    }
    const useChinese = this.useChinese();
    const provider = PROVIDER_LABELS[notification.provider];
    const title =
      notification.kind === "generation-completed"
        ? useChinese
          ? `${provider} 回复已完成`
          : `${provider} response completed`
        : notification.kind === "generation-failed"
          ? useChinese
            ? `${provider} 回复失败`
            : `${provider} response failed`
          : useChinese
            ? `${provider} 同步失败`
            : `${provider} sync failed`;
    const body =
      preferences.showPreview && notification.preview
        ? notification.preview.replace(/\s+/g, " ").trim().slice(0, 160)
        : useChinese
          ? "点击返回 AIHub 查看详情。"
          : "Click to return to AIHub for details.";
    const systemNotification = new Notification({ title, body });
    systemNotification.on("click", () => {
      this.showWindow();
      if (notification.conversationId) {
        this.openConversation(notification.conversationId);
      }
    });
    systemNotification.show();
  }

  notifyUpdateAvailable(version: string): void {
    if (
      !Notification.isSupported() ||
      (this.window.isVisible() && this.window.isFocused()) ||
      this.lastNotifiedUpdateVersion === version
    ) {
      return;
    }
    this.lastNotifiedUpdateVersion = version;
    const useChinese = this.useChinese();
    const notification = new Notification({
      title: useChinese
        ? `AIHub ${version} 可用`
        : `AIHub ${version} is available`,
      body: useChinese
        ? "打开“设置 > 关于”可下载更新。"
        : "Open Settings > About to download the update.",
    });
    notification.on("click", () => this.showWindow());
    notification.show();
  }

  prepareToQuit(): void {
    this.quitting = true;
    this.destroyTray();
  }

  destroy(): void {
    this.prepareToQuit();
  }

  private ensureTray(): void {
    if (this.tray) {
      this.updateTrayMenu();
      return;
    }
    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip("AIHub");
    this.tray.on("click", () => this.showWindow());
    this.updateTrayMenu();
  }

  private updateTrayMenu(): void {
    if (!this.tray) return;
    const useChinese = this.useChinese();
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: useChinese ? "打开 AIHub" : "Open AIHub",
          click: () => this.showWindow(),
        },
        { type: "separator" },
        {
          label: useChinese ? "退出" : "Quit",
          click: () => {
            this.quitting = true;
            app.quit();
          },
        },
      ]),
    );
  }

  private showWindow(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  private destroyTray(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private useChinese(): boolean {
    return (
      this.settings.locale === "zh-CN" ||
      (this.settings.locale === "system" &&
        app.getLocale().toLowerCase().startsWith("zh"))
    );
  }
}

function createTrayIcon() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">',
    '<rect width="32" height="32" rx="8" fill="#111827"/>',
    '<path d="M8 24 14 8h4l6 16h-4l-1.3-4H13l-1.3 4H8Zm6-7h3.7L16 12l-2 5Z" fill="#7ce6ae"/>',
    "</svg>",
  ].join("");
  return nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    )
    .resize({ width: 16, height: 16 });
}
