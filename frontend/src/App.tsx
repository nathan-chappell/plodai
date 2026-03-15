import { AppStateProvider } from "./app/context";
import { useAppRouteGuards, useAppSessionState, useToastState } from "./app/hooks";
import {
  AppEmptyMetaText,
  AppEmptyState,
  ToastCard,
  ToastDismissButton,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "./app/styles";
import { PlatformShell } from "./components/PlatformShell";
import { SignInPage } from "./components/SignInPage";
import { AdminUsersPage, adminUsersCapability } from "./capabilities/adminUsers";
import { ReportFoundryPage, reportFoundryCapability } from "./capabilities/reportFoundry";
import { navigate, usePathname } from "./lib/router";

const allCapabilities = [reportFoundryCapability, adminUsersCapability];

function filterCapabilities(role: "admin" | "user") {
  return allCapabilities.filter((capability) =>
    capability.tabs.some((tab) => (tab.visible ? tab.visible({ role }) : true)),
  );
}

function resolveVisibleCapability(pathname: string, role: "admin" | "user") {
  const capabilities = filterCapabilities(role);
  return capabilities.find((capability) => capability.path === pathname) ?? null;
}

export function App() {
  const pathname = usePathname();
  const { authError, hydrating, isSignedIn, reloadSession, setAuthError, user, setUser } = useAppSessionState();
  const { dismissToast, toasts } = useToastState();

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

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
  const currentUser = user;
  const capabilities = filterCapabilities(currentUser.role);
  const activeCapability = resolveVisibleCapability(pathname, currentUser.role);

  return (
    <AppStateProvider value={{ authError, setAuthError, user: currentUser, setUser }}>
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
        {activeCapability?.id === adminUsersCapability.id ? <AdminUsersPage /> : null}
      </PlatformShell>
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} $tone={toast.tone}>
            <ToastHeader>
              <ToastTitle>{toast.title}</ToastTitle>
              <ToastDismissButton onClick={() => dismissToast(toast.id)} type="button">
                Dismiss
              </ToastDismissButton>
            </ToastHeader>
            <AppEmptyMetaText>{toast.message}</AppEmptyMetaText>
          </ToastCard>
        ))}
      </ToastViewport>
    </AppStateProvider>
  );
}
