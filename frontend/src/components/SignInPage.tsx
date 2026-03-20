import { Show, SignIn, SignInButton, SignUpButton, useClerk } from "@clerk/react";

import { DEFAULT_AUTHENTICATED_PATH } from "../lib/auth";
import { navigate } from "../lib/router";
import { WRITING_INDEX_PATH } from "../lib/writing";
import { MetaText } from "../app/styles";
import {
  SignInErrorActions,
  SignInErrorCard,
  SignInActionButton,
  SignInButtonRow,
  SignInCard,
  SignInEyebrow,
  SignInFeatureList,
  SignInHero,
  SignInPageRoot,
  SignInSecondaryActionButton,
  SignInShell,
  SignInSubhead,
  SignInTitle,
} from "./styles";

function ClerkSignInCard({
  authError,
  hasClerkSession,
  onRetryAuth,
}: {
  authError: string | null;
  hasClerkSession: boolean;
  onRetryAuth: () => void;
}) {
  const { signOut } = useClerk();

  if (hasClerkSession && authError) {
    return (
      <SignInErrorCard>
        <h2>Authenticated, but workspace access failed</h2>
        <MetaText>
          Clerk accepted the sign-in, but the backend could not open an app session for this account.
        </MetaText>
        <strong>{authError}</strong>
        <SignInErrorActions>
          <SignInActionButton onClick={onRetryAuth} type="button">
            Retry access check
          </SignInActionButton>
          <SignInActionButton onClick={() => void signOut()} type="button">
            Sign out
          </SignInActionButton>
        </SignInErrorActions>
      </SignInErrorCard>
    );
  }

  return (
    <SignInCard>
      <h2>Clerk sign in</h2>
      <MetaText>
        Use your Clerk-backed identity. App access still depends on the public metadata that the backend checks after
        sign-in.
      </MetaText>
      <Show when="signed-out">
        <SignInButtonRow>
          <SignInButton mode="modal">
            <SignInActionButton type="button">Open sign in</SignInActionButton>
          </SignInButton>
          <SignUpButton mode="modal">
            <SignInActionButton type="button">Open sign up</SignInActionButton>
          </SignUpButton>
        </SignInButtonRow>
      </Show>
      <SignIn fallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH} signUpFallbackRedirectUrl={DEFAULT_AUTHENTICATED_PATH} />
    </SignInCard>
  );
}

export function SignInPage({
  authError,
  hasClerkSession,
  onRetryAuth,
}: {
  authError: string | null;
  hasClerkSession: boolean;
  onRetryAuth: () => void;
}) {
  return (
    <SignInPageRoot>
      <SignInShell>
        <SignInHero>
          <SignInEyebrow>AI Portfolio</SignInEyebrow>
          <SignInTitle>Sign in before opening the workspace</SignInTitle>
          <SignInSubhead>
            Keep authentication outside the app shell so the workspace can focus on capabilities, navigation, and
            account state once a user is approved and signed in.
          </SignInSubhead>
          <SignInFeatureList>
            <li>Unauthenticated users land on a dedicated sign-in route instead of seeing a half-open app shell.</li>
            <li>The authenticated app can assume a known session and keep the sidebar focused on capability state.</li>
            <li>Clerk handles sign-in, while backend access still checks role and activation in public metadata.</li>
          </SignInFeatureList>
          <SignInButtonRow>
            <SignInSecondaryActionButton onClick={() => navigate(WRITING_INDEX_PATH)} type="button">
              Browse writing
            </SignInSecondaryActionButton>
          </SignInButtonRow>
        </SignInHero>
        <ClerkSignInCard authError={authError} hasClerkSession={hasClerkSession} onRetryAuth={onRetryAuth} />
      </SignInShell>
    </SignInPageRoot>
  );
}
