import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const artifactDir = path.join(root, "artifacts", "ai-validation", runId);
const includeRealProviders = process.argv.includes("--real-providers");
const skipBuild = process.argv.includes("--skip-build");
const results = [];

await mkdir(artifactDir, { recursive: true });

const steps = [
  { name: "typecheck", args: ["pnpm", "typecheck"] },
  { name: "vitest", args: ["pnpm", "test"] },
  ...(!skipBuild
    ? [{
        name: "electron-build",
        args: ["pnpm", "--filter", "@aihub/desktop", "build"],
      }]
    : []),
  {
    name: "electron-playwright",
    args: ["pnpm", "--filter", "@aihub/desktop", "test:ai:e2e"],
  },
  ...(includeRealProviders
    ? [{
        name: "real-provider-equivalence",
        command: "node",
        args: ["./scripts/run-real-provider-matrix.mjs"],
      }]
    : []),
];

for (const step of steps) {
  const startedAt = new Date();
  const exitCode = await run(step.command ?? "corepack", step.args, {
    ...process.env,
    AIHUB_AI_ARTIFACT_DIR: artifactDir,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  });
  results.push({
    name: step.name,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
  });
  if (exitCode !== 0) break;
}

const passed = results.length === steps.length && results.every((result) => result.exitCode === 0);
const report = {
  runId,
  startedFrom: root,
  artifactDir,
  includeRealProviders,
  passed,
  results,
};
await writeFile(
  path.join(artifactDir, "manifest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(artifactDir, "report.md"),
  markdownReport(report),
  "utf8",
);

console.log(`\nAI validation ${passed ? "PASSED" : "FAILED"}`);
console.log(`Report: ${path.join(artifactDir, "report.md")}`);
process.exitCode = passed ? 0 : 1;

function run(command, args, env) {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    const executable = windows ? process.env.ComSpec ?? "cmd.exe" : command;
    const spawnArgs = windows
      ? ["/d", "/s", "/c", windowsCommand([command, ...args])]
      : args;
    const child = spawn(executable, spawnArgs, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", (error) => {
      console.error(`Unable to start ${command}:`, error);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function windowsCommand(parts) {
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_@./:+-]+$/.test(part)) {
      throw new Error(`Unsupported command token: ${part}`);
    }
  }
  return parts.join(" ");
}

function markdownReport(report) {
  const rows = report.results
    .map(
      (result) =>
        `| ${result.name} | ${result.status} | ${result.exitCode} | ${(result.durationMs / 1_000).toFixed(1)}s |`,
    )
    .join("\n");
  return `# LLM Workbench AI Validation Report

- Run: ${report.runId}
- Result: ${report.passed ? "PASS" : "FAIL"}
- Real providers: ${report.includeRealProviders ? "enabled" : "not requested"}
- Artifact directory: ${report.artifactDir}

| Step | Status | Exit code | Duration |
|---|---|---:|---:|
${rows}

The Playwright HTML, JSON and JUnit results are stored next to this report. Failure-only screenshots and traces are saved under test-results.
`;
}
