import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { PlatformShell } from "./components/PlatformShell";
import { ReportFoundryPage, reportFoundryCapability } from "./capabilities/reportFoundry";
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

  useEffect(() => {
    async function hydrateUser() {
      if (!getStoredToken()) {
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/auth/me");
        setUser(me);
      } catch {
        storeToken(null);
      }
    }

    void hydrateUser();
  }, []);

  useEffect(() => {
    if (pathname === "/") {
      navigate(reportFoundryCapability.path);
    }
  }, [pathname]);

  const activeCapability = useMemo(() => resolveCapability(pathname), [pathname]);

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

      {activeCapability?.id === reportFoundryCapability.id && user ? <ReportFoundryPage user={user} /> : null}

      {activeCapability?.id === reportFoundryCapability.id && !user ? (
        <EmptyState>
          <strong>{reportFoundryCapability.title}</strong>
          <MetaText>
            Sign in to open this capability. The page shell is now route-based, so additional capabilities can slot in
            beside this one without reworking the app root.
          </MetaText>
        </EmptyState>
      ) : null}
    </PlatformShell>
  );
}
