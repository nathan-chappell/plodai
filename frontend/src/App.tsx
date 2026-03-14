import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { PlatformShell } from "./components/PlatformShell";
import { SignInPage } from "./components/SignInPage";
import { ReportFoundryPage, reportFoundryCapability } from "./capabilities/reportFoundry";
import { DEFAULT_AUTHENTICATED_PATH, SIGN_IN_PATH, isClerkEnabled } from "./lib/auth";
import { navigate, usePathname } from "./lib/router";
import { apiRequest, getStoredToken, storeToken } from "./lib/api";
import type { AuthUser } from "./types/auth";
import { MetaText, panelSurfaceCss } from "./ui/primitives";

const EmptyState = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.6rem;
  display: grid;
  gap: 0.8rem;
`;

const capabilities = [reportFoundryCapability];

function resolveCapability(pathname: string) {
  return capabilities.find((capability) => capability.path === pathname) ?? null;
}

export function App() {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    async function hydrateUser() {
      if (!getStoredToken() && !isClerkEnabled()) {
        setHydrating(false);
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/auth/me");
        setUser(me);
      } catch {
        storeToken(null);
      } finally {
        setHydrating(false);
      }
    }

    void hydrateUser();
  }, []);

  useEffect(() => {
    if (pathname === "/") {
      navigate(user ? DEFAULT_AUTHENTICATED_PATH : SIGN_IN_PATH);
    }
  }, [pathname, user]);

  useEffect(() => {
    if (hydrating) {
      return;
    }
    if (!user && pathname !== SIGN_IN_PATH) {
      navigate(SIGN_IN_PATH);
      return;
    }
    if (user && pathname === SIGN_IN_PATH) {
      navigate(DEFAULT_AUTHENTICATED_PATH);
    }
  }, [hydrating, pathname, user]);

  const activeCapability = useMemo(() => resolveCapability(pathname), [pathname]);

  if (hydrating) {
    return (
      <EmptyState>
        <strong>Loading session</strong>
        <MetaText>Checking whether you already have an authenticated workspace session.</MetaText>
      </EmptyState>
    );
  }

  if (!user) {
    return <SignInPage onAuthenticated={setUser} />;
  }

  return (
    <PlatformShell
      user={user}
      capabilities={capabilities}
      activeCapabilityId={activeCapability?.id ?? null}
      onSelectCapability={navigate}
      onAuthenticated={setUser}
    >
      {!activeCapability ? (
        <EmptyState>
          <strong>Unknown route</strong>
          <MetaText>Pick one of the registered capabilities from the shell navigation.</MetaText>
        </EmptyState>
      ) : null}

      {activeCapability?.id === reportFoundryCapability.id ? <ReportFoundryPage user={user} /> : null}
    </PlatformShell>
  );
}
