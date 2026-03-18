import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const baseURL = (process.env.BASE_URL ?? "http://127.0.0.1:8000").trim();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 8 * 60 * 1000,
  expect: {
    timeout: 30 * 1000,
  },
  outputDir: "test-results/fire",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/fire" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "auth",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "chromium",
      dependencies: ["auth"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
    },
  ],
});
