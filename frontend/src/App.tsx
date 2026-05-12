import { Suspense, lazy, useEffect, useState } from "react";

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
  loadPreferredOutputLanguage,
  persistPreferredOutputLanguage,
  type PreferredOutputLanguage,
} from "./lib/chat-language";
import {
  ACCOUNT_PATH,
  ADMIN_USERS_PATH,
  isAccountPath,
  isAdminUsersPath,
  navigate,
  PLODAI_PATH,
  usePathname,
} from "./lib/router";

const PlodaiFarmPane = lazy(async () => {
  const module = await import("./components/PlodaiFarmPane");
  return { default: module.PlodaiFarmPane };
});

const AdminUsersPage = lazy(async () => {
  const module = await import("./components/AdminUsersPage");
  return { default: module.AdminUsersPage };
});

const AccountBillingPage = lazy(async () => {
  const module = await import("./components/AccountBillingPage");
  return { default: module.AccountBillingPage };
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
  const [preferredOutputLanguage, setPreferredOutputLanguage] = useState<PreferredOutputLanguage>(() =>
    loadPreferredOutputLanguage(),
  );

  useEffect(() => {
    persistPreferredOutputLanguage(preferredOutputLanguage);
  }, [preferredOutputLanguage]);

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

  if (hydrating) {
    return (
      <AppEmptyState>
        <strong>Loading session</strong>
        <AppEmptyMetaText>Checking whether you already have an authenticated PlodAI session.</AppEmptyMetaText>
      </AppEmptyState>
    );
  }

  if (!user) {
    return (
      <SignInPage
        authError={authError}
        hasClerkSession={isSignedIn}
        onPreferredOutputLanguageChange={setPreferredOutputLanguage}
        onRetryAuth={reloadSession}
        preferredOutputLanguage={preferredOutputLanguage}
      />
    );
  }

  const currentUser = user;
  const showingAdmin = isAdminUsersPath(pathname) && currentUser.role === "admin";
  const showingAccount = isAccountPath(pathname);
  const activePath = showingAdmin ? ADMIN_USERS_PATH : showingAccount ? ACCOUNT_PATH : PLODAI_PATH;

  return (
    <AppStateProvider
      value={{
        authError,
        setAuthError,
        user: currentUser,
        setUser,
        preferredOutputLanguage,
        setPreferredOutputLanguage,
      }}
    >
      <PlatformShell
        activePath={activePath}
        canViewAdmin={currentUser.role === "admin"}
        title={showingAdmin ? "PlodAI admin" : showingAccount ? "PlodAI account" : "PlodAI field desk"}
      >
        <Suspense fallback={<RouteLoadingState label={showingAdmin ? "admin" : showingAccount ? "account" : "cases"} />}>
          {showingAdmin ? <AdminUsersPage /> : showingAccount ? <AccountBillingPage /> : <PlodaiFarmPane />}
        </Suspense>
      </PlatformShell>
      <ToastLayer {...toastState} />
    </AppStateProvider>
  );
}
