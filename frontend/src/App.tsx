import { useMemo } from "react";

import { AppStateProvider } from "./app/context";
import { useAppRouteGuards, useAppSessionState } from "./app/hooks";
import { AppEmptyMetaText, AppEmptyState } from "./app/styles";
import { PlatformShell } from "./components/PlatformShell";
import { SignInPage } from "./components/SignInPage";
import { ReportFoundryPage, reportFoundryCapability } from "./capabilities/reportFoundry";
import { navigate, usePathname } from "./lib/router";

const capabilities = [reportFoundryCapability];

function resolveCapability(pathname: string) {
  return capabilities.find((capability) => capability.path === pathname) ?? null;
}

export function App() {
  const pathname = usePathname();
  const { authError, hydrating, isSignedIn, reloadSession, setAuthError, user, setUser } = useAppSessionState();

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

  const activeCapability = useMemo(() => resolveCapability(pathname), [pathname]);

  if (hydrating) {
    return (
      <AppEmptyState>
        <strong>Loading session</strong>
        <AppEmptyMetaText>Checking whether you already have an authenticated workspace session.</AppEmptyMetaText>
      </AppEmptyState>
    );
  }

  if (!user) {
    return <SignInPage authError={authError} hasClerkSession={isSignedIn} onRetryAuth={reloadSession} />;
  }

  return (
    <AppStateProvider value={{ authError, setAuthError, user, setUser }}>
      <PlatformShell
        capabilities={capabilities}
        activeCapabilityId={activeCapability?.id ?? null}
        onSelectCapability={navigate}
      >
        {!activeCapability ? (
          <AppEmptyState>
            <strong>Unknown route</strong>
            <AppEmptyMetaText>Pick one of the registered capabilities from the shell navigation.</AppEmptyMetaText>
          </AppEmptyState>
        ) : null}

        {activeCapability?.id === reportFoundryCapability.id ? <ReportFoundryPage /> : null}
      </PlatformShell>
    </AppStateProvider>
  );
}
