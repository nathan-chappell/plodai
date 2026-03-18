import { expect, type Page, type TestInfo } from "@playwright/test";

type HarnessSnapshot = {
  statusEvents: Array<{ value: string; recordedAt: string }>;
  clientToolCalls: Array<{ name: string; arguments: Record<string, unknown>; recordedAt: string }>;
  effectEvents: Array<{ name: string; recordedAt: string }>;
  appendedFiles: Array<{ id: string; name: string; kind: string; recordedAt: string }>;
  threadIds: Array<{ value: string; recordedAt: string }>;
  chatkitResponses: Array<{
    url: string;
    status: number;
    contentType: string;
    body: string;
    markers: string[];
    recordedAt: string;
  }>;
};

type DemoConfig = {
  capabilityId: "csv-agent" | "chart-agent" | "pdf-agent" | "report-agent";
  path: string;
  requiredToolNames: string[];
  requiredEffectNames?: string[];
  requiredResponseMarkers?: string[];
  visibleSelectors?: string[];
  postRunAssertion?: (page: Page, snapshot: HarnessSnapshot) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function shouldRunDemo(capabilityId: DemoConfig["capabilityId"]): boolean {
  const requested = process.env.FIRE_TEST_DEMO?.trim();
  return !requested || requested === capabilityId;
}

export function getFireTestLoginMode(): "clerk_password" | "google" {
  const mode = process.env.FIRE_TEST_LOGIN_MODE?.trim().toLowerCase();
  return mode === "google" ? "google" : "clerk_password";
}

export async function signInWithClerk(
  page: Page,
  credentials: { email: string; password: string },
  options?: { mode?: "clerk_password" | "google" },
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const mode = options?.mode ?? "clerk_password";

  if (mode === "google") {
    await signInWithGooglePopup(page, credentials);
    return;
  }

  const emailInput = page.locator('input[name*="identifier"], input[type="email"], input[name*="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 60_000 });
  await emailInput.fill(credentials.email);

  const passwordInput = page.locator('input[type="password"]').first();
  if (!(await passwordInput.isVisible().catch(() => false))) {
    await clickFirstVisible(page, [/continue/i, /next/i, /sign in/i]);
    await passwordInput.waitFor({ state: "visible", timeout: 60_000 });
  }

  await passwordInput.fill(credentials.password);
  await clickFirstVisible(page, [/sign in/i, /continue/i]);
}

async function signInWithGooglePopup(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  const googleButton = await findFirstVisibleButton(page, [
    /continue with google/i,
    /sign in with google/i,
    /^google$/i,
  ]);
  const popupPromise = page.waitForEvent("popup", { timeout: 60_000 });
  await googleButton.click();
  const popup = await popupPromise;

  await popup.waitForLoadState("domcontentloaded");
  await handleGoogleAccountChooser(popup, credentials.email);

  const emailInput = popup.locator('input[type="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(credentials.email);
    await clickFirstVisible(popup, [/next/i]);
  }

  const passwordInput = popup.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 60_000 });
  await passwordInput.fill(credentials.password);
  await clickFirstVisible(popup, [/next/i]);

  await Promise.race([
    popup.waitForEvent("close", { timeout: 120_000 }).catch(() => null),
    page.waitForURL(/\/capabilities\//, { timeout: 120_000 }).catch(() => null),
  ]);
}

async function handleGoogleAccountChooser(popup: Page, email: string): Promise<void> {
  const useAnotherAccount = popup.getByRole("button", { name: /use another account/i }).first();
  if (await useAnotherAccount.isVisible().catch(() => false)) {
    await useAnotherAccount.click();
    return;
  }

  const existingAccount = popup.getByText(email, { exact: false }).first();
  if (await existingAccount.isVisible().catch(() => false)) {
    await existingAccount.click();
  }
}

async function clickFirstVisible(page: Page, labels: RegExp[]): Promise<void> {
  const button = await findFirstVisibleButton(page, labels);
  await button.click();
}

async function findFirstVisibleButton(page: Page, labels: RegExp[]) {
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      return button;
    }
  }
  throw new Error(`Could not find a Clerk button matching: ${labels.map(String).join(", ")}`);
}

export async function runDemoFireTest(
  page: Page,
  testInfo: TestInfo,
  config: DemoConfig,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await openDemoPage(page, config);
      await resetHarness(page);
      await clickRunDemo(page);
      await waitForRunCompletion(page);
      const snapshot = await getHarnessSnapshot(page);

      await attachHarnessArtifacts(testInfo, config.capabilityId, attempt, snapshot);
      await assertOutcomeContract(page, config, snapshot);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const snapshot = await getHarnessSnapshot(page).catch(() => null);
      if (snapshot) {
        await attachHarnessArtifacts(testInfo, `${config.capabilityId}-failed`, attempt, snapshot);
      }
      if (attempt === 2) {
        throw lastError;
      }
      await page.goto(config.path, { waitUntil: "domcontentloaded" });
    }
  }

  throw lastError ?? new Error(`Demo ${config.capabilityId} did not complete.`);
}

async function openDemoPage(page: Page, config: DemoConfig): Promise<void> {
  await page.goto(config.path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`capability-nav-${config.capabilityId}`)).toBeVisible();
  await page.getByTestId(`${config.capabilityId}-tab-demo`).click();
  await expect(page.getByTestId(`${config.capabilityId}-demo-workspace`)).toBeVisible();
  await expect(page.getByTestId("chatkit-quick-action-run-demo")).toBeEnabled({ timeout: 120_000 });
}

async function clickRunDemo(page: Page): Promise<void> {
  await page.getByTestId("chatkit-quick-action-run-demo").click();
}

async function waitForRunCompletion(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const harness = window.__fireTestHarness;
      if (!harness) {
        return false;
      }
      const snapshot = harness.getSnapshot();
      if (!snapshot.clientToolCalls.length) {
        return false;
      }
      return snapshot.statusEvents.some((event) => event.value === "Agent run finished.");
    },
    undefined,
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  await expect(page.getByTestId("chatkit-status")).toContainText("Agent run finished.", { timeout: 30_000 });
}

async function assertOutcomeContract(
  page: Page,
  config: DemoConfig,
  snapshot: HarnessSnapshot,
): Promise<void> {
  expect(snapshot.clientToolCalls.length).toBeGreaterThan(0);
  expect(snapshot.statusEvents.some((event) => event.value === "Agent run in progress.")).toBe(true);
  expect(snapshot.statusEvents.some((event) => event.value === "Agent run finished.")).toBe(true);

  const observedToolNames = snapshot.clientToolCalls.map((call) => call.name);
  for (const toolName of config.requiredToolNames) {
    expect(observedToolNames).toContain(toolName);
  }

  const observedEffectNames = snapshot.effectEvents.map((event) => event.name);
  for (const effectName of config.requiredEffectNames ?? []) {
    expect(observedEffectNames).toContain(effectName);
  }

  const observedMarkers = new Set(snapshot.chatkitResponses.flatMap((entry) => entry.markers));
  for (const marker of config.requiredResponseMarkers ?? []) {
    expect(observedMarkers.has(marker)).toBe(true);
  }

  for (const selector of config.visibleSelectors ?? []) {
    await expect(page.getByTestId(selector)).toBeVisible();
  }

  await config.postRunAssertion?.(page, snapshot);
}

async function attachHarnessArtifacts(
  testInfo: TestInfo,
  label: string,
  attempt: number,
  snapshot: HarnessSnapshot,
): Promise<void> {
  await testInfo.attach(`${label}-attempt-${attempt}-harness.json`, {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
}

export async function getHarnessSnapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => {
    const harness = (window as Window & {
      __fireTestHarness?: {
        getSnapshot: () => HarnessSnapshot;
      };
    }).__fireTestHarness;
    return (
      harness?.getSnapshot() ?? {
        statusEvents: [],
        clientToolCalls: [],
        effectEvents: [],
        appendedFiles: [],
        threadIds: [],
        chatkitResponses: [],
      }
    );
  });
}

async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & {
      __fireTestHarness?: {
        reset: () => void;
      };
    }).__fireTestHarness?.reset();
  });
}
