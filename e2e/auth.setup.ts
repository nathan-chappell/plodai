import { mkdirSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { getFireTestLoginMode, getRequiredEnv, signInWithClerk } from "./support/fire-test";

setup("authenticate with real Clerk UI", async ({ page, context }) => {
  const loginMode = getFireTestLoginMode();
  const email = getRequiredEnv(
    loginMode === "google" ? "FIRE_TEST_GOOGLE_EMAIL" : "FIRE_TEST_CLERK_EMAIL",
  );
  const password = getRequiredEnv(
    loginMode === "google" ? "FIRE_TEST_GOOGLE_PASSWORD" : "FIRE_TEST_CLERK_PASSWORD",
  );

  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await signInWithClerk(page, { email, password }, { mode: loginMode });

  await expect(page).toHaveURL(/\/capabilities\//, { timeout: 120_000 });
  await expect(page.getByText("Capability Platform")).toBeVisible({ timeout: 30_000 });

  mkdirSync("playwright/.auth", { recursive: true });
  await context.storageState({ path: "playwright/.auth/user.json" });
});
