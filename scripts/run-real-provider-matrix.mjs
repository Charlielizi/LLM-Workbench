import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const providerIds = [
  "chatgpt",
  "claude",
  "doubao",
  "kimi",
  "deepseek",
  "hunyuan",
  "qianwen",
];
const providerArgument = process.argv.find((value) =>
  value.startsWith("--providers="),
);
const providers = providerArgument
  ? providerArgument
      .slice("--providers=".length)
      .split(",")
      .map((value) => value.trim())
      .filter((value) => providerIds.includes(value))
  : providerIds;
const port = Number(process.env.AIHUB_CDP_PORT ?? 9222);
const roundTimeoutMs = Number(process.env.AIHUB_REAL_ROUND_TIMEOUT_MS ?? 600_000);
const artifactRoot = process.env.AIHUB_AI_ARTIFACT_DIR
  ? path.resolve(process.env.AIHUB_AI_ARTIFACT_DIR, "real-providers")
  : path.resolve("artifacts", "provider-equivalence", new Date().toISOString().replaceAll(":", "-"));
const scriptPath = path.resolve("scripts", "run-provider-multiturn-cdp.mjs");
const results = [];

await mkdir(artifactRoot, { recursive: true });

for (const provider of providers) {
  const providerDir = path.join(artifactRoot, provider);
  await mkdir(providerDir, { recursive: true });
  const execution = await runProvider(provider);
  const summaryLine = execution.stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith("AIHUB_MULTITURN_RESULT="));
  let summary;
  try {
    summary = summaryLine
      ? JSON.parse(summaryLine.slice("AIHUB_MULTITURN_RESULT=".length))
      : undefined;
  } catch {
    summary = undefined;
  }
  const status = summary?.status === "AuthBlocked"
    ? "AuthBlocked"
    : execution.exitCode === 0 && summary?.passed
      ? "Passed"
      : "Failed";
  const result = {
    provider,
    status,
    exitCode: execution.exitCode,
    summary,
  };
  results.push(result);
  await writeFile(
    path.join(providerDir, "console.log"),
    `${execution.stdout}${execution.stderr ? `\n${execution.stderr}` : ""}`,
    "utf8",
  );
  await writeFile(
    path.join(providerDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

const requiredProviders = results.filter((result) =>
  !["chatgpt", "claude"].includes(result.provider),
);
const passed =
  requiredProviders.length > 0 &&
  requiredProviders.every((result) => result.status === "Passed") &&
  results
    .filter((result) => ["chatgpt", "claude"].includes(result.provider))
    .every((result) => ["Passed", "AuthBlocked"].includes(result.status));
const report = {
  generatedAt: new Date().toISOString(),
  port,
  roundTimeoutMs,
  artifactRoot,
  passed,
  results,
};
await writeFile(
  path.join(artifactRoot, "matrix.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(artifactRoot, "report.md"),
  [
    "# LLM Workbench Real Provider Equivalence Matrix",
    "",
    `- Result: ${passed ? "PASS" : "FAIL"}`,
    `- CDP port: ${port}`,
    `- Per-round timeout: ${roundTimeoutMs} ms`,
    "",
    "| Provider | Status | Completed rounds | Conversation |",
    "|---|---|---:|---|",
    ...results.map((result) =>
      `| ${result.provider} | ${result.status} | ${result.summary?.completedRounds ?? 0} | ${result.summary?.conversationId ?? "-"} |`,
    ),
    "",
    "Each completed round verifies exactly one marker, minimum answer length, and equality between the normalized LLM Workbench body hash and the provider website body hash.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Real provider matrix ${passed ? "PASSED" : "FAILED"}`);
console.log(`Report: ${path.join(artifactRoot, "report.md")}`);
process.exitCode = passed ? 0 : 1;

function runProvider(provider) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [scriptPath, String(port), provider, String(roundTimeoutMs)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AIHUB_REAL_PROVIDER_ARTIFACT_DIR: path.join(artifactRoot, provider),
        },
        shell: false,
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.once("error", (error) => {
      stderr += `${error.stack ?? error.message}\n`;
      resolve({ exitCode: 1, stdout, stderr });
    });
    child.once("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
