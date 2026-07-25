import path from "node:path";
import { defineConfig } from "@playwright/test";

const artifactRoot = process.env.AIHUB_AI_ARTIFACT_DIR
  ? path.resolve(process.env.AIHUB_AI_ARTIFACT_DIR)
  : path.resolve(process.cwd(), "../../artifacts/ai-validation/latest");

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(artifactRoot, "test-results"),
  timeout: 60_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.005,
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(artifactRoot, "html"), open: "never" }],
    ["json", { outputFile: path.join(artifactRoot, "results.json") }],
    ["junit", { outputFile: path.join(artifactRoot, "junit.xml") }],
  ],
});
