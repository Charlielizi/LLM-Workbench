import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { VitePlugin } from "@electron-forge/plugin-vite";

const certificateFile = process.env.AIHUB_WINDOWS_CERT_FILE;
const certificatePassword = process.env.AIHUB_WINDOWS_CERT_PASSWORD;
const signingMode = process.env.AIHUB_SIGNING_MODE ?? "pfx";
const isExternalSigning = signingMode === "signpath";
const hasPfxSigning = Boolean(certificateFile && certificatePassword);
if (signingMode !== "pfx" && !isExternalSigning) {
  throw new Error(
    "AIHUB_SIGNING_MODE must be either 'pfx' or 'signpath'.",
  );
}
if (
  process.env.AIHUB_RELEASE_BUILD === "1" &&
  ((!hasPfxSigning && !isExternalSigning) ||
    !process.env.AIHUB_UPDATE_URL?.startsWith("https://"))
) {
  throw new Error(
    "Release builds require either PFX signing credentials or " +
      "AIHUB_SIGNING_MODE=signpath, plus an HTTPS AIHUB_UPDATE_URL.",
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "llm-workbench",
    executableName: "LLMWorkbench",
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "llm-workbench",
      setupExe: "LLM-Workbench-Setup.exe",
      ...(hasPfxSigning && !isExternalSigning
        ? { certificateFile, certificatePassword }
        : {}),
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/provider-preload.ts",
          config: "vite.provider-preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
