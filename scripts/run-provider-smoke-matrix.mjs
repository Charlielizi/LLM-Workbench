import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "run-provider-smoke-matrix.ps1");
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const child = spawn("powershell", [
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  ...args,
], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
