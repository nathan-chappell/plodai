import { SignInButton, SignUpButton, useClerk } from "@clerk/react";

import { DEFAULT_AUTHENTICATED_PATH } from "../lib/auth";
import { MetaText } from "../app/styles";
import type { PreferredOutputLanguage } from "../lib/chat-language";
import { BRAND_MARK_URL } from "../lib/brand";
import {
  SignInBrand,
  SignInBrandLogo,
  SignInCardBody,
  SignInCardTitle,
  SignInErrorActions,
  SignInErrorCard,
  SignInActionButton,
  SignInButtonRow,
  SignInCard,
  SignInEyebrow,
  SignInLanguageButton,
  SignInLanguageLabel,
  SignInLanguageToggle,
  SignInLead,
  SignInPageRoot,
  SignInShell,
  SignInTopBar,
  SignInSubhead,
  SignInSecondaryActionButton,
  SignInTitle,
} from "./styles";
import { PlatformThemeProvider } from "./platformTheme";

const SIGN_IN_COPY: Record<
  PreferredOutputLanguage,
  {
    accessBody: string;
    accessErrorBody: string;
    accessErrorTitle: string;
    accessTitle: string;
    createAccountLabel: string;
    languageLabel: string;
    languageNote: string;
    retryLabel: string;
    signInLabel: string;
    signOutLabel: string;
    subtitle: string;
    title: string;
  }
> = {
  hr: {
    accessBody:
      "Prijava ide kroz Clerk, ali sama registracija ne otključava aplikaciju. PlodAI se otvara tek nakon što backend odobri ovaj račun za pristup.",
    accessErrorBody:
      "Clerk je prihvatio prijavu, ali ovaj račun još nema odobren pristup aplikaciji. Nakon registracije javite se vlasniku aplikacije e-poštom kako bi aktivirao račun.",
    accessErrorTitle: "Prijava je uspjela, ali pristup aplikaciji nije",
    accessTitle: "Pristup preko Clerka",
    createAccountLabel: "Registracija",
    languageLabel: "Jezik",
    languageNote: "Ovaj izbor odmah postavlja jezik ChatKit prijedloga i placeholdera.",
    retryLabel: "Ponovi provjeru",
    signInLabel: "Prijava",
    signOutLabel: "Odjava",
    subtitle:
      "Jedna prijava, jedan ekran i izravan ulaz u farme, slike i PlodAI chat.",
    title: "Prijavite se u PlodAI",
  },
  en: {
    accessBody:
      "Clerk handles authentication first, but creating an account does not automatically unlock the app. PlodAI opens only after the backend approves this account for access.",
    accessErrorBody:
      "Clerk accepted the sign-in, but this account does not have app access yet. After signing up, email the app owner so the account can be activated.",
    accessErrorTitle: "Sign-in worked, but app access did not",
    accessTitle: "Clerk-backed access",
    createAccountLabel: "Create account",
    languageLabel: "Language",
    languageNote: "This selection immediately drives the ChatKit starter prompts and composer placeholder.",
    retryLabel: "Retry access check",
    signInLabel: "Sign in",
    signOutLabel: "Sign out",
    subtitle:
      "One sign-in, one screen, and a direct path into farms, images, and the PlodAI chat.",
    title: "Sign in to PlodAI",
  },
};

function ClerkSignInCard({
  authError,
  hasClerkSession,
  onRetryAuth,
  preferredOutputLanguage,
}: {
  authError: string | null;
  hasClerkSession: boolean;
  onRetryAuth: () => void;
  preferredOutputLanguage: PreferredOutputLanguage;
}) {
  const { signOut } = useClerk();
  const copy = SIGN_IN_COPY[preferredOutputLanguage];

  if (hasClerkSession && authError) {
    return (
      <SignInErrorCard>
        <SignInCardTitle>{copy.accessErrorTitle}</SignInCardTitle>
        <MetaText>{copy.accessErrorBody}</MetaText>
        <strong>{authError}</strong>
        <SignInErrorActions>
          <SignInActionButton onClick={onRetryAuth} type="button">
            {copy.retryLabel}
          </SignInActionButton>
          <SignInSecondaryActionButton onClick={() => void signOut()} type="button">
            {copy.signOutLabel}
          </SignInSecondaryActionButton>
        </SignInErrorActions>
      </SignInErrorCard>
    );
  }

  return (
    <SignInCardBody>
      <SignInCardTitle>{copy.accessTitle}</SignInCardTitle>
      <MetaText>{copy.accessBody}</MetaText>
      <SignInButtonRow>
        <SignInButton
          fallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH}
          mode="modal"
          signUpFallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH}
        >
          <SignInActionButton type="button">{copy.signInLabel}</SignInActionButton>
        </SignInButton>
        <SignUpButton
          fallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH}
          mode="modal"
          signInFallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH}
        >
          <SignInSecondaryActionButton type="button">
            {copy.createAccountLabel}
          </SignInSecondaryActionButton>
        </SignUpButton>
      </SignInButtonRow>
    </SignInCardBody>
  );
}

export function SignInPage({
  authError,
  hasClerkSession,
  onRetryAuth,
  preferredOutputLanguage,
  onPreferredOutputLanguageChange,
}: {
  authError: string | null;
  hasClerkSession: boolean;
  onRetryAuth: () => void;
  preferredOutputLanguage: PreferredOutputLanguage;
  onPreferredOutputLanguageChange: (language: PreferredOutputLanguage) => void;
}) {
  const copy = SIGN_IN_COPY[preferredOutputLanguage];

  return (
    <PlatformThemeProvider agentId="plodai-agent">
      <SignInPageRoot>
        <SignInShell>
          <SignInCard>
            <SignInTopBar>
              <SignInBrand>
                <SignInBrandLogo alt="" aria-hidden="true" src={BRAND_MARK_URL} />
                <div>
                  <SignInEyebrow>PlodAI</SignInEyebrow>
                </div>
              </SignInBrand>

              <div>
                <SignInLanguageLabel>{copy.languageLabel}</SignInLanguageLabel>
                <SignInLanguageToggle aria-label={copy.languageLabel}>
                  <SignInLanguageButton
                    $active={preferredOutputLanguage === "hr"}
                    onClick={() => onPreferredOutputLanguageChange("hr")}
                    type="button"
                  >
                    HR
                  </SignInLanguageButton>
                  <SignInLanguageButton
                    $active={preferredOutputLanguage === "en"}
                    onClick={() => onPreferredOutputLanguageChange("en")}
                    type="button"
                  >
                    EN
                  </SignInLanguageButton>
                </SignInLanguageToggle>
              </div>
            </SignInTopBar>

            <SignInTitle>{copy.title}</SignInTitle>
            <SignInSubhead>{copy.subtitle}</SignInSubhead>
            <SignInLead>{copy.languageNote}</SignInLead>

            <ClerkSignInCard
              authError={authError}
              hasClerkSession={hasClerkSession}
              onRetryAuth={onRetryAuth}
              preferredOutputLanguage={preferredOutputLanguage}
            />
          </SignInCard>
        </SignInShell>
      </SignInPageRoot>
    </PlatformThemeProvider>
  );
}
