import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { apiRequest } from "../lib/api";
import { isClerkEnabled } from "../lib/auth";
import { mountClerkSignIn, subscribeToClerkAuth } from "../lib/clerk";
import type { AuthUser } from "../types/auth";
import { MetaText, displayHeadingCss, panelSurfaceCss } from "../ui/primitives";
import { AuthPanel } from "./AuthPanel";

const Page = styled.main`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
`;

const Shell = styled.div`
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 420px);
  gap: 1.25rem;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const Hero = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 2rem;
  display: grid;
  gap: 1rem;
  background:
    linear-gradient(145deg, rgba(255, 252, 247, 0.96), rgba(239, 228, 214, 0.92)),
    radial-gradient(circle at top right, rgba(73, 127, 162, 0.14), transparent 34%);
`;

const Eyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

const Title = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 4.2rem);
  line-height: 0.96;
`;

const Subhead = styled.p`
  margin: 0;
  max-width: 58ch;
  color: var(--muted);
  font-size: 1.04rem;
  line-height: 1.75;
`;

const FeatureList = styled.ul`
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.65rem;
  color: var(--ink);
`;

const AuthCard = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.2rem;
  display: grid;
  gap: 0.9rem;
  align-self: start;
`;

const ClerkMount = styled.div`
  min-height: 540px;
`;

function ClerkSignInCard({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [message, setMessage] = useState("Loading Clerk sign-in...");

  useEffect(() => {
    let cleanup = () => {};

    async function mount() {
      if (!mountRef.current) {
        return;
      }
      cleanup = await mountClerkSignIn(mountRef.current);
    }

    void mount();
    return () => cleanup();
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};

    async function connect() {
      unsubscribe = await subscribeToClerkAuth(async (clerk) => {
        if (!clerk?.session) {
          setMessage("Sign in with Clerk to continue.");
          return;
        }
        try {
          const user = await apiRequest<AuthUser>("/auth/me");
          onAuthenticated(user);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Unable to finish Clerk sign-in.");
        }
      });
    }

    void connect();
    return () => unsubscribe();
  }, [onAuthenticated]);

  return (
    <AuthCard>
      <h2>Clerk sign in</h2>
      <MetaText>
        Use your Clerk-backed identity. App access still depends on the approved users table and role assignments on the
        backend.
      </MetaText>
      <ClerkMount ref={mountRef} />
      <MetaText>{message}</MetaText>
    </AuthCard>
  );
}

export function SignInPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser | null) => void;
}) {
  return (
    <Page>
      <Shell>
        <Hero>
          <Eyebrow>AI Portfolio</Eyebrow>
          <Title>Sign in before opening the workspace</Title>
          <Subhead>
            Keep authentication outside the app shell so the platform area can focus on capabilities, navigation, and
            account state. This gives us a much cleaner seam for Clerk when we switch over.
          </Subhead>
          <FeatureList>
            <li>Unauthenticated users land on a dedicated sign-in route instead of seeing a half-open app shell.</li>
            <li>The authenticated app can now assume a known session and keep the sidebar focused on account state.</li>
            <li>Local auth still works today, but this route is ready to host Clerk components next.</li>
          </FeatureList>
        </Hero>

        {isClerkEnabled() ? (
          <ClerkSignInCard onAuthenticated={onAuthenticated} />
        ) : (
          <AuthPanel
            user={null}
            onAuthenticated={onAuthenticated}
            heading="Sign in"
            subtitle="Current local auth stays active while we prepare the move to Clerk."
          />
        )}
      </Shell>
    </Page>
  );
}
