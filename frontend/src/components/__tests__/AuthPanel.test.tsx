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

  it("shows account details without a theme settings control", async () => {
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
          <AuthPanel mode="account" heading="Account" />
        </AppStateProvider>,
      );
    });

    expect(container.querySelector("[data-testid='account-theme-trigger']")).toBeNull();
    expect(container.querySelector("[data-testid='account-theme-popover']")).toBeNull();
    expect(container.textContent).toContain("Nathan Chappell");
    expect(container.textContent).toContain("Balance $0.89");
    expect(container.textContent).toContain("Credits N/A");
    expect(container.querySelector("[data-testid='mock-user-button']")).not.toBeNull();
    expect(container.textContent).toContain("Sign out");
  });
});
