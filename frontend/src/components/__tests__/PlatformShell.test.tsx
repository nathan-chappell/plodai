import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppStateProvider } from "../../app/context";

vi.mock("../AuthPanel", () => ({
  AuthPanel: () => <div data-testid="mock-auth-panel">Auth</div>,
}));

import { PlatformShell } from "../PlatformShell";

describe("PlatformShell", () => {
  it("renders the compact HR / EN language toggle in the top header", () => {
    const markup = renderToStaticMarkup(
      <AppStateProvider
        value={{
          user: null,
          setUser: vi.fn(),
          authError: null,
          setAuthError: vi.fn(),
          preferredOutputLanguage: "hr",
          setPreferredOutputLanguage: vi.fn(),
        }}
      >
        <PlatformShell activePath="/plodai" title="PlodAI">
          <div>Pane</div>
        </PlatformShell>
      </AppStateProvider>,
    );

    expect(markup).toContain("HR");
    expect(markup).toContain("EN");
    expect(markup).not.toContain("Reply language");
  });
});
