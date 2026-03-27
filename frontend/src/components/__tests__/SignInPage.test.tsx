import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-sign-in-button">{children}</div>
  ),
  SignUpButton: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-sign-up-button">{children}</div>
  ),
  useClerk: () => ({
    signOut: vi.fn(),
  }),
}));

import { SignInPage } from "../SignInPage";

describe("SignInPage", () => {
  it("renders the simplified English sign-in card with a language toggle", () => {
    const markup = renderToStaticMarkup(
      <SignInPage
        authError={null}
        hasClerkSession={false}
        onPreferredOutputLanguageChange={vi.fn()}
        onRetryAuth={vi.fn()}
        preferredOutputLanguage="en"
      />,
    );

    expect(markup).toContain("Sign in to PlodAI");
    expect(markup).toContain("One sign-in, one screen");
    expect(markup).toContain("Sign in");
    expect(markup).toContain("Create account");
    expect(markup).toContain("Language");
    expect(markup).toContain("HR");
    expect(markup).toContain("EN");
    expect(markup).not.toContain("Sign in before opening your farms");
  });

  it("renders the Croatian access error state for authenticated failures", () => {
    const markup = renderToStaticMarkup(
      <SignInPage
        authError="Backend access denied."
        hasClerkSession
        onPreferredOutputLanguageChange={vi.fn()}
        onRetryAuth={vi.fn()}
        preferredOutputLanguage="hr"
      />,
    );

    expect(markup).toContain("Prijava je uspjela, ali pristup aplikaciji nije");
    expect(markup).toContain("Clerk je prihvatio prijavu");
    expect(markup).toContain("Ponovi provjeru");
    expect(markup).toContain("Odjava");
    expect(markup).toContain("Backend access denied.");
    expect(markup).not.toContain("Registracija");
  });
});
