import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { VitePlugin } from "@electron-forge/plugin-vite";

const certificateFile = process.env.AIHUB_WINDOWS_CERT_FILE;
const certificatePassword = process.env.AIHUB_WINDOWS_CERT_PASSWORD;
if (
  process.env.AIHUB_RELEASE_BUILD === "1" &&
  (!certificateFile ||
    !certificatePassword ||
    !process.env.AIHUB_UPDATE_URL?.startsWith("https://"))
) {
  throw new Error(
    "Release builds require AIHUB_WINDOWS_CERT_FILE, " +
      "AIHUB_WINDOWS_CERT_PASSWORD, and an HTTPS AIHUB_UPDATE_URL.",
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "AIHub",
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "aihub",
      setupExe: "AIHub-Setup.exe",
      ...(certificateFile && certificatePassword
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
