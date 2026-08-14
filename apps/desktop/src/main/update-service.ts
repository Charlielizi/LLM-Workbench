import https from "node:https";
import { app, autoUpdater } from "electron";
import type { UpdatePolicy, UpdateState } from "@aihub/core";

declare const __AIHUB_UPDATE_URL__: string;

interface UpdateServiceOptions {
  beforeInstall: () => Promise<void>;
  onState: (state: UpdateState) => void;
  updateUrl?: string;
  readReleaseIndex?: (url: string) => Promise<string>;
}

export class UpdateService {
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
  };
  private metadataCheckStarted = false;
  private downloaded = false;
  private policy: UpdatePolicy = "manual";
  private policyTimer?: ReturnType<typeof setInterval>;
  private readonly updateUrl?: string;
  private readonly readReleaseIndex: (url: string) => Promise<string>;
  private readonly removeUpdaterListeners: Array<() => void> = [];

  constructor(private readonly options: UpdateServiceOptions) {
    this.updateUrl = validateUpdateUrl(
      options.updateUrl ??
        builtInUpdateUrl() ??
        process.env.AIHUB_UPDATE_URL,
    );
    this.readReleaseIndex = options.readReleaseIndex ?? readHttpsText;
    const errorListener = (error: Error) => {
      this.setState({
        status: "error",
        currentVersion: app.getVersion(),
        error: error.message,
      });
    };
    const notAvailableListener = () => {
      this.setState({
        status: "not-available",
        currentVersion: app.getVersion(),
      });
    };
    const downloadedListener = (
      _event: Electron.Event,
      releaseNotes: string,
      releaseName: string,
    ) => {
      this.downloaded = true;
      this.setState({
        status: "downloaded",
        currentVersion: app.getVersion(),
        availableVersion: extractVersion(String(releaseName ?? "")),
        releaseName: String(releaseName ?? releaseNotes ?? ""),
      });
    };
    autoUpdater.on("error", errorListener);
    autoUpdater.on("update-not-available", notAvailableListener);
    autoUpdater.on("update-downloaded", downloadedListener);
    this.removeUpdaterListeners.push(
      () => autoUpdater.removeListener("error", errorListener),
      () =>
        autoUpdater.removeListener(
          "update-not-available",
          notAvailableListener,
        ),
      () =>
        autoUpdater.removeListener(
          "update-downloaded",
          downloadedListener,
        ),
    );
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  applyPolicy(policy: UpdatePolicy): void {
    this.policy = policy;
    if (policy === "manual" || !this.updateUrl) {
      if (this.policyTimer) {
        clearInterval(this.policyTimer);
        this.policyTimer = undefined;
      }
      return;
    }
    if (!this.policyTimer) {
      this.policyTimer = setInterval(() => {
        if (
          this.state.status !== "checking" &&
          this.state.status !== "downloading" &&
          this.state.status !== "downloaded"
        ) {
          void this.runPolicyCheck();
        }
      }, 24 * 60 * 60 * 1_000);
      this.policyTimer.unref();
    }
    if (policy === "auto-download" && this.state.status === "available") {
      void this.download();
      return;
    }
    if (this.metadataCheckStarted) return;
    this.metadataCheckStarted = true;
    void this.runPolicyCheck();
  }

  async check(): Promise<UpdateState> {
    if (!this.updateUrl) {
      return this.setState({
        status: "error",
        currentVersion: app.getVersion(),
        error: "The signed update feed is not configured.",
      });
    }
    this.setState({
      status: "checking",
      currentVersion: app.getVersion(),
    });
    try {
      const index = await this.readReleaseIndex(
        new URL("RELEASES", ensureTrailingSlash(this.updateUrl)).toString(),
      );
      const availableVersion = newestReleaseVersion(index);
      if (
        !availableVersion ||
        compareVersions(availableVersion, app.getVersion()) <= 0
      ) {
        return this.setState({
          status: "not-available",
          currentVersion: app.getVersion(),
        });
      }
      return this.setState({
        status: "available",
        currentVersion: app.getVersion(),
        availableVersion,
      });
    } catch (error) {
      return this.setState({
        status: "error",
        currentVersion: app.getVersion(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async download(): Promise<UpdateState> {
    if (!this.updateUrl) return this.check();
    if (this.state.status !== "available") {
      const checked = await this.check();
      if (checked.status !== "available") return checked;
    }
    if (!app.isPackaged) {
      return this.setState({
        ...this.state,
        status: "error",
        error: "Updates can only be downloaded by an installed LLM Workbench build.",
      });
    }
    try {
      autoUpdater.setFeedURL({ url: this.updateUrl });
      this.setState({
        ...this.state,
        status: "downloading",
      });
      autoUpdater.checkForUpdates();
      return this.getState();
    } catch (error) {
      return this.setState({
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async install(): Promise<void> {
    if (!this.downloaded || this.state.status !== "downloaded") {
      throw new Error("No downloaded update is ready to install.");
    }
    await this.options.beforeInstall();
    autoUpdater.quitAndInstall();
  }

  destroy(): void {
    if (this.policyTimer) {
      clearInterval(this.policyTimer);
      this.policyTimer = undefined;
    }
    for (const removeListener of this.removeUpdaterListeners.splice(0)) {
      removeListener();
    }
  }

  private async runPolicyCheck(): Promise<void> {
    const state = await this.check();
    if (this.policy === "auto-download" && state.status === "available") {
      await this.download();
    }
  }

  private setState(state: UpdateState): UpdateState {
    this.state = state;
    this.options.onState(this.getState());
    return this.getState();
  }
}

function builtInUpdateUrl(): string | undefined {
  if (
    typeof __AIHUB_UPDATE_URL__ === "string" &&
    __AIHUB_UPDATE_URL__.length > 0
  ) {
    return __AIHUB_UPDATE_URL__;
  }
  return undefined;
}

export function newestReleaseVersion(index: string): string | undefined {
  const versions = [
    ...index.matchAll(
      /-([0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?)-full\.nupkg/gi,
    ),
  ]
    .map((match) => match[1])
    .filter((version): version is string => Boolean(version));
  return versions.sort(compareVersions).at(-1);
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference =
      (leftVersion.release[index] ?? 0) -
      (rightVersion.release[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (
    leftVersion.prerelease.length === 0 ||
    rightVersion.prerelease.length === 0
  ) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) {
      return 0;
    }
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart - rightPart;
    }
    if (typeof leftPart === "number") return -1;
    if (typeof rightPart === "number") return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function parseVersion(version: string): {
  release: number[];
  prerelease: Array<string | number>;
} {
  const normalized = version.replace(/^v/i, "").split("+", 1)[0]!;
  const separator = normalized.indexOf("-");
  const releaseText =
    separator === -1 ? normalized : normalized.slice(0, separator);
  const prereleaseText =
    separator === -1 ? "" : normalized.slice(separator + 1);
  const release = releaseText
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  const prerelease = prereleaseText
    .split(".")
    .filter(Boolean)
    .flatMap((part) => part.match(/[A-Za-z]+|[0-9]+/g) ?? [part])
    .map((part) => (/^[0-9]+$/.test(part) ? Number(part) : part.toLowerCase()));
  return { release, prerelease };
}

function extractVersion(value: string): string | undefined {
  return value.match(/[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?/)?.[0];
}

function validateUpdateUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("AIHUB_UPDATE_URL must use HTTPS.");
  }
  return parsed.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readHttpsText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 15_000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Update feed returned HTTP ${response.statusCode}.`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) {
          request.destroy(new Error("Update feed response is too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () =>
        resolve(Buffer.concat(chunks).toString("utf8")),
      );
    });
    request.on("timeout", () =>
      request.destroy(new Error("Update feed request timed out.")),
    );
    request.on("error", reject);
  });
}
