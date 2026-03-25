import { Suspense, lazy } from "react";

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
import {
  ADMIN_USERS_PATH,
  isAdminUsersPath,
  isFarmOrderPath,
  navigate,
  PLODAI_PATH,
  usePathname,
} from "./lib/router";

const FarmOrderPage = lazy(async () => {
  const module = await import("./components/FarmOrderPage");
  return { default: module.FarmOrderPage };
});

const PlodaiFarmPane = lazy(async () => {
  const module = await import("./components/PlodaiFarmPane");
  return { default: module.PlodaiFarmPane };
});

const AdminUsersPage = lazy(async () => {
  const module = await import("./components/AdminUsersPage");
  return { default: module.AdminUsersPage };
});

function RouteLoadingState({ label }: { label: string }) {
  return (
    <AppEmptyState>
      <strong>Loading {label}</strong>
      <AppEmptyMetaText>Fetching the PlodAI route you asked for.</AppEmptyMetaText>
    </AppEmptyState>
  );
}

function ToastLayer({
  dismissToast,
  toasts,
}: ReturnType<typeof useToastState>) {
  return (
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
  );
}

export function App() {
  const pathname = usePathname();
  const { authError, hydrating, isSignedIn, reloadSession, setAuthError, user, setUser } = useAppSessionState();
  const toastState = useToastState();
  const viewingPublicFarmOrder = isFarmOrderPath(pathname);

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

  if (pathname === "/") {
    navigate(PLODAI_PATH);
    return null;
  }

  if (viewingPublicFarmOrder) {
    return (
      <>
        <Suspense fallback={<RouteLoadingState label="farm order" />}>
          <FarmOrderPage />
        </Suspense>
        <ToastLayer {...toastState} />
      </>
    );
  }

  if (hydrating) {
    return (
      <AppEmptyState>
        <strong>Loading session</strong>
        <AppEmptyMetaText>Checking whether you already have an authenticated PlodAI session.</AppEmptyMetaText>
      </AppEmptyState>
    );
  }

  if (!user) {
    return <SignInPage authError={authError} hasClerkSession={isSignedIn} onRetryAuth={reloadSession} />;
  }

  const currentUser = user;
  const showingAdmin = isAdminUsersPath(pathname) && currentUser.role === "admin";
  const activePath = showingAdmin ? ADMIN_USERS_PATH : PLODAI_PATH;

  return (
    <AppStateProvider value={{ authError, setAuthError, user: currentUser, setUser }}>
      <PlatformShell
        activePath={activePath}
        canViewAdmin={currentUser.role === "admin"}
        title={showingAdmin ? "PlodAI admin" : "PlodAI"}
      >
        <Suspense fallback={<RouteLoadingState label={showingAdmin ? "admin" : "farms"} />}>
          {showingAdmin ? <AdminUsersPage /> : <PlodaiFarmPane />}
        </Suspense>
      </PlatformShell>
      <ToastLayer {...toastState} />
    </AppStateProvider>
  );
}
