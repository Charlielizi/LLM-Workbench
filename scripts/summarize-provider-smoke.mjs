import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_PROVIDERS = [
  "chatgpt",
  "claude",
  "doubao",
  "kimi",
  "deepseek",
  "hunyuan",
  "qianwen",
];

export function resolveProviderId(provider) {
  return provider === "yuanbao" ? "hunyuan" : provider;
}

export function getUserDataDirs(explicitDir = "") {
  if (String(explicitDir).trim()) return [explicitDir];
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return [
    path.join(appData, "AIHub"),
    path.join(appData, "@aihub", "desktop"),
    path.join(appData, "Electron"),
  ];
}

async function readRuntimeInfo(userDataDir) {
  try {
    const runtimeInfoPath = path.join(userDataDir, "diagnostics", "runtime-info.json");
    return JSON.parse((await fs.readFile(runtimeInfoPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function isRuntimeAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function resolveActiveUserDataDirs(explicitDir = "") {
  const dirs = getUserDataDirs(explicitDir);
  if (String(explicitDir).trim()) return dirs;

  const live = [];
  for (const dir of dirs) {
    const runtime = await readRuntimeInfo(dir);
    if (!runtime?.pid || !isRuntimeAlive(runtime.pid)) continue;
    const startedAt = Number.isFinite(Date.parse(runtime.startedAt ?? ""))
      ? Date.parse(runtime.startedAt)
      : Number.MIN_SAFE_INTEGER;
    live.push({ dir, startedAt });
  }

  if (live.length === 0) return dirs;
  live.sort((left, right) => right.startedAt - left.startedAt);
  return [live[0].dir];
}

export async function getLatestExistingResult(providerId, userDataDirs) {
  const candidates = [];
  for (const userDataDir of userDataDirs) {
    const resultPath = path.join(userDataDir, "diagnostics", `provider-smoke-${providerId}.json`);
    try {
      const stat = await fs.stat(resultPath);
      if (stat.isFile()) {
        candidates.push({ path: resultPath, mtimeMs: stat.mtimeMs });
      }
    } catch {}
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (candidates.length === 0) return null;

  let latestUnreadable = null;
  for (const candidate of candidates) {
    try {
      const raw = (await fs.readFile(candidate.path, "utf8")).replace(/^\uFEFF/, "");
      const json = JSON.parse(raw);
      return { path: candidate.path, json };
    } catch {
      if (!latestUnreadable) {
        latestUnreadable = { path: candidate.path, json: null };
      }
    }
  }

  return latestUnreadable;
}

export function summarizeResult(provider, result) {
  if (!result || !result.json) {
    return {
      provider,
      outcome: "missing",
      verification: "none",
      failurePhase: "none",
      failureCode: "none",
      reason: "No smoke result file was found.",
      path: result?.path ?? "none",
    };
  }

  const summary = result.json.diagnostics?.providerSummary;
  const assistant = result.json.assistantMessage;
  const outcome = assistant?.status === "completed"
    ? "completed"
    : result.json.timeout
      ? "timeout"
      : result.json.error
        ? "error"
        : "failed";

  return {
    provider,
    outcome,
    verification: result.json.verification?.kind ?? "none",
    failurePhase: summary?.lastFailurePhase ?? "none",
    failureCode: summary?.lastFailureCode ?? "none",
    reason: summary?.reason ?? result.json.sendError ?? "none",
    path: result.path,
  };
}

export function parseCliArgs(argv) {
  let providers = DEFAULT_PROVIDERS;
  let userDataDir = "";

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current) continue;

    if (current === "-Providers" || current === "--providers") {
      providers = String(next ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (current === "-UserDataDir" || current === "--userDataDir") {
      userDataDir = String(next ?? "").trim();
      index += 1;
    }
  }

  return {
    providers: providers.length > 0 ? providers : DEFAULT_PROVIDERS,
    userDataDir,
  };
}

export async function buildSummaryRows({
  providers = DEFAULT_PROVIDERS,
  userDataDir = "",
} = {}) {
  const rows = [];
  const userDataDirs = await resolveActiveUserDataDirs(userDataDir);

  for (const provider of providers) {
    const result = await getLatestExistingResult(resolveProviderId(provider), userDataDirs);
    rows.push(summarizeResult(provider, result));
  }

  return rows;
}

export function formatMarkdownTable(rows) {
  const lines = [
    "| Provider | Outcome | Verification | Failure phase | Failure code | Reason |",
    "|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const reason = String(row.reason ?? "none").replace(/\r?\n/g, " ").trim();
    lines.push(
      `| ${row.provider} | ${row.outcome} | ${row.verification} | ${row.failurePhase} | ${row.failureCode} | ${reason} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const rows = await buildSummaryRows(parseCliArgs(process.argv.slice(2)));
  process.stdout.write(`${formatMarkdownTable(rows)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
