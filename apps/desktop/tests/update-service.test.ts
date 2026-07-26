import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn().mockReturnValue("0.1.0"),
    isPackaged: true,
  },
  autoUpdater: {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      electronMocks.listeners.set(event, listener);
    }),
    setFeedURL: electronMocks.setFeedURL,
    checkForUpdates: electronMocks.checkForUpdates,
    quitAndInstall: electronMocks.quitAndInstall,
    removeListener: electronMocks.removeListener,
  },
}));

import {
  compareVersions,
  newestReleaseVersion,
  UpdateService,
} from "../src/main/update-service";

beforeEach(() => {
  electronMocks.setFeedURL.mockClear();
  electronMocks.checkForUpdates.mockClear();
  electronMocks.quitAndInstall.mockClear();
  electronMocks.removeListener.mockClear();
});

describe("UpdateService", () => {
  it("parses and compares Squirrel release versions", () => {
    const index = [
      "hash aihub-0.1.1-full.nupkg 1",
      "hash aihub-0.2.0-full.nupkg 2",
      "hash aihub-0.1.5-full.nupkg 3",
    ].join("\n");
    expect(newestReleaseVersion(index)).toBe("0.2.0");
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.1.0-rc1", "0.1.0-rc.1")).toBe(0);
    expect(compareVersions("0.2.0-rc10", "0.2.0-rc2")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-rc.2", "0.2.0-rc.10")).toBeLessThan(0);
  });

  it("checks metadata before download and backs up before installation", async () => {
    const beforeInstall = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];
    const service = new UpdateService({
      beforeInstall,
      onState: (state) => states.push(state.status),
      updateUrl: "https://updates.example.com/aihub/",
      readReleaseIndex: vi
        .fn()
        .mockResolvedValue("hash aihub-0.2.0-full.nupkg 100"),
    });

    await expect(service.check()).resolves.toMatchObject({
      status: "available",
      availableVersion: "0.2.0",
    });
    await expect(service.download()).resolves.toMatchObject({
      status: "downloading",
    });
    expect(electronMocks.setFeedURL).toHaveBeenCalledWith({
      url: "https://updates.example.com/aihub/",
    });
    expect(electronMocks.checkForUpdates).toHaveBeenCalledOnce();

    electronMocks.listeners.get("update-downloaded")?.(
      {},
      "Release notes",
      "AIHub 0.2.0",
    );
    await service.install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(electronMocks.quitAndInstall).toHaveBeenCalledOnce();
    expect(states).toContain("downloaded");
  });

  it("refuses non-HTTPS update feeds", () => {
    expect(
      () =>
        new UpdateService({
          beforeInstall: vi.fn(),
          onState: vi.fn(),
          updateUrl: "http://updates.example.com/",
        }),
    ).toThrow(/HTTPS/);
  });

  it("starts a pending download when policy changes to auto-download", async () => {
    const service = new UpdateService({
      beforeInstall: vi.fn(),
      onState: vi.fn(),
      updateUrl: "https://updates.example.com/aihub/",
      readReleaseIndex: vi
        .fn()
        .mockResolvedValue("hash aihub-0.2.0-full.nupkg 100"),
    });
    await service.check();

    service.applyPolicy("auto-download");

    await vi.waitFor(() =>
      expect(electronMocks.checkForUpdates).toHaveBeenCalledOnce(),
    );
    expect(service.getState().status).toBe("downloading");
  });

  it("removes Electron updater listeners when the window lifecycle ends", () => {
    const service = new UpdateService({
      beforeInstall: vi.fn(),
      onState: vi.fn(),
    });

    service.destroy();
    service.destroy();

    expect(electronMocks.removeListener).toHaveBeenCalledTimes(3);
  });
});
