import path from "node:path";
import { defineConfig } from "@playwright/test";

const artifactRoot = process.env.AIHUB_AI_ARTIFACT_DIR
  ? path.resolve(process.env.AIHUB_AI_ARTIFACT_DIR)
  : path.resolve(process.cwd(), "../../artifacts/ai-validation/latest");
const screenshotDiffRatio = process.env.CI ? 0.015 : 0.005;
const testTimeoutMs = process.env.CI ? 120_000 : 60_000;
const expectTimeoutMs = 15_000;

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(artifactRoot, "test-results"),
  timeout: testTimeoutMs,
  expect: {
    timeout: expectTimeoutMs,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: screenshotDiffRatio,
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(artifactRoot, "html"), open: "never" }],
    ["json", { outputFile: path.join(artifactRoot, "results.json") }],
    ["junit", { outputFile: path.join(artifactRoot, "junit.xml") }],
  ],
});
