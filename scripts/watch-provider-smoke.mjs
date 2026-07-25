import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawArgs = process.argv.slice(2);
const forwardedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const scriptPath = path.join(__dirname, "watch-provider-smoke.ps1");

const result = spawnSync(
  "powershell",
  [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...forwardedArgs,
  ],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
