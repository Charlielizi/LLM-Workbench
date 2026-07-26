import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const notificationInstances: Array<{
    options: { title: string; body: string };
    listeners: Map<string, () => void>;
    show: ReturnType<typeof vi.fn>;
  }> = [];
  const trayInstances: Array<{
    on: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    notificationInstances,
    trayInstances,
    setLoginItemSettings: vi.fn(),
    quit: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn().mockReturnValue("en-US"),
    setLoginItemSettings: electronMocks.setLoginItemSettings,
    quit: electronMocks.quit,
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
  },
  nativeImage: {
    createFromDataURL: vi.fn(() => ({
      resize: vi.fn(() => ({})),
    })),
  },
  Notification: class {
    static isSupported(): boolean {
      return true;
    }
    private readonly instance: (typeof electronMocks.notificationInstances)[number];
    constructor(options: { title: string; body: string }) {
      this.instance = {
        options,
        listeners: new Map(),
        show: vi.fn(),
      };
      electronMocks.notificationInstances.push(this.instance);
    }
    on(event: string, listener: () => void): void {
      this.instance.listeners.set(event, listener);
    }
    show(): void {
      this.instance.show();
    }
  },
  Tray: class {
    private readonly instance = {
      on: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
    };
    constructor() {
      electronMocks.trayInstances.push(this.instance);
    }
    setToolTip(): void {}
    on = this.instance.on;
    setContextMenu = this.instance.setContextMenu;
    destroy = this.instance.destroy;
  },
}));

import { SystemIntegration } from "../src/main/system-integration";

beforeEach(() => {
  electronMocks.notificationInstances.length = 0;
  electronMocks.trayInstances.length = 0;
  electronMocks.setLoginItemSettings.mockClear();
  electronMocks.quit.mockClear();
});

describe("SystemIntegration", () => {
  it("applies login/tray settings and minimizes on close", () => {
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
    };
    const integration = new SystemIntegration(
      window as never,
      vi.fn(),
    );
    integration.apply({
      locale: "en-US",
      launchAtLogin: true,
      trayEnabled: true,
      closeBehavior: "minimize-to-tray",
    });
    const event = { preventDefault: vi.fn() };
    integration.handleWindowClose(event as never);

    expect(electronMocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
    });
    expect(electronMocks.trayInstances).toHaveLength(1);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it("keeps notification content private by default and opens its conversation", () => {
    const openConversation = vi.fn();
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
    };
    const integration = new SystemIntegration(
      window as never,
      openConversation,
    );
    integration.apply({
      locale: "en-US",
      notificationPreferences: {
        generationCompleted: true,
        generationFailed: true,
        syncFailed: true,
        showPreview: false,
      },
    });
    integration.notify({
      kind: "generation-completed",
      provider: "chatgpt",
      conversationId: "conversation-1",
      preview: "Sensitive response text",
    });

    const notification = electronMocks.notificationInstances[0]!;
    expect(notification.options.body).not.toContain("Sensitive");
    notification.listeners.get("click")?.();
    expect(window.show).toHaveBeenCalledOnce();
    expect(openConversation).toHaveBeenCalledWith("conversation-1");
  });

  it("does not duplicate in-app feedback with a system notification while focused", () => {
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(true),
      isFocused: vi.fn().mockReturnValue(true),
      restore: vi.fn(),
    };
    const integration = new SystemIntegration(window as never, vi.fn());
    integration.apply({
      notificationPreferences: {
        generationCompleted: true,
        generationFailed: true,
        syncFailed: true,
        showPreview: true,
      },
    });

    integration.notify({
      kind: "generation-failed",
      provider: "claude",
      preview: "Failure detail",
    });

    expect(electronMocks.notificationInstances).toHaveLength(0);
  });

  it("announces an available update once while the app is in the background", () => {
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
    };
    const integration = new SystemIntegration(window as never, vi.fn());

    integration.notifyUpdateAvailable("0.2.0");
    integration.notifyUpdateAvailable("0.2.0");

    expect(electronMocks.notificationInstances).toHaveLength(1);
    expect(electronMocks.notificationInstances[0]!.options.title).toContain(
      "0.2.0",
    );
  });
});
