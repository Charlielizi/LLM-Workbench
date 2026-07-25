import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface ProviderSmokeSummaryModule {
  DEFAULT_PROVIDERS?: string[];
  resolveActiveUserDataDirs?(explicitDir?: string): Promise<string[]>;
  buildSummaryRows(input?: {
    providers?: string[];
    userDataDir?: string;
  }): Promise<Array<{
    provider: string;
    outcome: string;
    verification: string;
    failurePhase: string;
    failureCode: string;
    reason: string;
    path: string;
  }>>;
  formatMarkdownTable(rows: Array<{
    provider: string;
    outcome: string;
    verification: string;
    failurePhase: string;
    failureCode: string;
    reason: string;
    path: string;
  }>): string;
  resolveProviderId(provider: string): string;
}

async function loadSummaryModule(): Promise<ProviderSmokeSummaryModule> {
  const moduleUrl = pathToFileURL(
    path.resolve(process.cwd(), "../../scripts/summarize-provider-smoke.mjs"),
  ).href;
  return import(moduleUrl) as Promise<ProviderSmokeSummaryModule>;
}

describe("provider smoke summary script", () => {
  let tempDir: string | undefined;
  const originalAppData = process.env.APPDATA;

  afterEach(async () => {
    process.env.APPDATA = originalAppData;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("normalizes yuanbao to hunyuan", async () => {
    const { resolveProviderId, DEFAULT_PROVIDERS } = await loadSummaryModule();
    expect(resolveProviderId("yuanbao")).toBe("hunyuan");
    expect(resolveProviderId("kimi")).toBe("kimi");
    expect(DEFAULT_PROVIDERS).toContain("hunyuan");
    expect(DEFAULT_PROVIDERS).not.toContain("yuanbao");
  });

  it("summarizes the latest smoke result files with JSON parsing independent of PowerShell", async () => {
    const { buildSummaryRows, formatMarkdownTable } = await loadSummaryModule();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-summary-"));
    const diagnosticsDir = path.join(tempDir, "diagnostics");
    await mkdir(diagnosticsDir, { recursive: true });

    await writeFile(
      path.join(diagnosticsDir, "provider-smoke-kimi.json"),
      JSON.stringify({
        provider: "kimi",
        sendError: "Login or provider verification is blocking the composer.",
        verification: {
          kind: "auth-blocked",
        },
        diagnostics: {
          providerSummary: {
            id: "kimi",
            authenticated: false,
            ready: false,
            degraded: false,
            lastFailurePhase: "checking-auth",
            lastFailureCode: "auth_required",
            websiteVisible: true,
            reason: "Login or provider verification is blocking the composer.",
          },
        },
      }, null, 2),
      "utf8",
    );

    await writeFile(
      path.join(diagnosticsDir, "provider-smoke-doubao.json"),
      JSON.stringify({
        provider: "doubao",
        assistantMessage: { status: "completed" },
        verification: {
          kind: "normal-send-completed",
        },
        diagnostics: {
          providerSummary: {
            id: "doubao",
            authenticated: true,
            ready: true,
            degraded: false,
            websiteVisible: true,
          },
        },
      }, null, 2),
      "utf8",
    );

    const rows = await buildSummaryRows({
      providers: ["kimi", "doubao", "yuanbao"],
      userDataDir: tempDir,
    });
    const table = formatMarkdownTable(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        provider: "kimi",
        outcome: "failed",
        verification: "auth-blocked",
        failurePhase: "checking-auth",
        failureCode: "auth_required",
      }),
      expect.objectContaining({
        provider: "doubao",
        outcome: "completed",
        verification: "normal-send-completed",
        failurePhase: "none",
        failureCode: "none",
      }),
      expect.objectContaining({
        provider: "yuanbao",
        outcome: "missing",
        verification: "none",
      }),
    ]);
    expect(table).toContain("| kimi | failed | auth-blocked | checking-auth | auth_required |");
    expect(table).toContain("| doubao | completed | normal-send-completed | none | none | none |");
    expect(table).toContain("| yuanbao | missing | none | none | none | No smoke result file was found. |");
  });

  it("prefers only the newest active runtime directory and parses UTF-8 BOM smoke JSON", async () => {
    const { buildSummaryRows, resolveActiveUserDataDirs } = await loadSummaryModule();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "aihub-smoke-summary-appdata-"));
    process.env.APPDATA = tempDir;

    const staleDiagnosticsDir = path.join(tempDir, "AIHub", "diagnostics");
    const liveDiagnosticsDir = path.join(tempDir, "@aihub", "desktop", "diagnostics");
    const newerDiagnosticsDir = path.join(tempDir, "Electron", "diagnostics");
    await mkdir(staleDiagnosticsDir, { recursive: true });
    await mkdir(liveDiagnosticsDir, { recursive: true });
    await mkdir(newerDiagnosticsDir, { recursive: true });

    await writeFile(
      path.join(staleDiagnosticsDir, "runtime-info.json"),
      JSON.stringify({
        instanceId: "stale-runtime",
        pid: 999999,
        startedAt: "2026-07-01T00:00:00.000Z",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(liveDiagnosticsDir, "runtime-info.json"),
      JSON.stringify({
        instanceId: "live-runtime",
        pid: process.pid,
        startedAt: "2026-07-10T03:00:00.000Z",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(newerDiagnosticsDir, "runtime-info.json"),
      JSON.stringify({
        instanceId: "newest-runtime",
        pid: process.pid,
        startedAt: "2026-07-10T04:00:00.000Z",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(staleDiagnosticsDir, "provider-smoke-chatgpt.json"),
      JSON.stringify({
        provider: "chatgpt",
        error: "stale result",
        verification: { kind: "fatal-error" },
        diagnostics: {
          providerSummary: {
            id: "chatgpt",
            authenticated: false,
            ready: false,
            degraded: true,
            websiteVisible: true,
            lastFailurePhase: "submitting",
            lastFailureCode: "provider_submit_not_found",
            reason: "stale-result",
          },
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(newerDiagnosticsDir, "provider-smoke-chatgpt.json"),
      `\uFEFF${JSON.stringify({
        provider: "chatgpt",
        sendError: "Login required.",
        verification: { kind: "auth-blocked" },
        diagnostics: {
          providerSummary: {
            id: "chatgpt",
            authenticated: false,
            ready: false,
            degraded: false,
            websiteVisible: true,
            lastFailurePhase: "checking-auth",
            lastFailureCode: "auth_required",
            reason: "live-result",
          },
        },
      }, null, 2)}`,
      "utf8",
    );

    await expect(resolveActiveUserDataDirs?.()).resolves.toEqual([
      path.join(tempDir, "Electron"),
    ]);

    const rows = await buildSummaryRows({
      providers: ["chatgpt"],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        provider: "chatgpt",
        outcome: "failed",
        verification: "auth-blocked",
        failurePhase: "checking-auth",
        failureCode: "auth_required",
        reason: "live-result",
      }),
    ]);
  });
});
