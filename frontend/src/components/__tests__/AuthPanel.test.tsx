// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  Show: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UserButton: () => <div data-testid="mock-user-button">user</div>,
  useClerk: () => ({
    signOut: vi.fn(async () => {}),
  }),
}));

import { AppStateProvider } from "../../app/context";
import { AuthPanel } from "../AuthPanel";
import { PlatformThemeProvider } from "../platformTheme";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AuthPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("shows a compact theme trigger near account actions and opens the full popover", async () => {
    await act(async () => {
      root.render(
        <AppStateProvider
          value={{
            authError: null,
            setAuthError: vi.fn(),
            user: {
              id: "user_1",
              email: "nathan@example.com",
              full_name: "Nathan Chappell",
              role: "admin",
              is_active: true,
              current_credit_usd: 0.89,
              credit_floor_usd: -1,
            },
            setUser: vi.fn(),
          }}
        >
          <PlatformThemeProvider>
            <AuthPanel mode="account" heading="Account" />
          </PlatformThemeProvider>
        </AppStateProvider>,
      );
    });

    const trigger = container.querySelector("[data-testid='account-theme-trigger']") as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
    });

    expect(container.querySelector("[data-testid='account-theme-popover']")).not.toBeNull();
    expect(container.textContent).toContain("Editorial");
    expect(container.textContent).toContain("Coast");
    expect(container.textContent).toContain("Ember");
    expect(container.textContent).toContain("Light");
    expect(container.textContent).toContain("Dark");
    expect(container.textContent).toContain("Balance $0.89");
    expect(container.textContent).toContain("Credits N/A");
    expect(container.textContent).not.toContain("Admin capabilities");
  });
});
