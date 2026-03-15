import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";

import { DEFAULT_AUTHENTICATED_PATH, SIGN_IN_PATH } from "../lib/auth";
import { ApiError, apiRequest, setClerkTokenGetter } from "../lib/api";
import { navigate } from "../lib/router";
import type { AuthUser } from "../types/auth";
import { subscribeToToasts, type AppToast } from "./toasts";

export function useAppSessionState() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const hasClerkSession = isSignedIn === true;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [sessionReloadKey, setSessionReloadKey] = useState(0);

  useEffect(() => {
    setClerkTokenGetter(async () => (await getToken()) ?? null);
    return () => {
      setClerkTokenGetter(null);
    };
  }, [getToken]);

  useEffect(() => {
    async function hydrateUser() {
      if (!isLoaded) {
        return;
      }
      if (!hasClerkSession) {
        setUser(null);
        setAuthError(null);
        setHydrating(false);
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/auth/me");
        setUser(me);
        setAuthError(null);
      } catch (error) {
        setUser(null);
        if (error instanceof ApiError) {
          setAuthError(error.message);
        } else if (error instanceof Error) {
          setAuthError(error.message);
        } else {
          setAuthError("We could not verify your authenticated session.");
        }
      } finally {
        setHydrating(false);
      }
    }

    void hydrateUser();
  }, [hasClerkSession, isLoaded, sessionReloadKey]);

  return {
    authError,
    hydrating,
    isSignedIn: hasClerkSession,
    reloadSession: () => {
      setHydrating(true);
      setSessionReloadKey((value) => value + 1);
    },
    setAuthError,
    user,
    setUser,
  };
}

export function useAppRouteGuards({
  pathname,
  user,
  hydrating,
  authError,
}: {
  pathname: string;
  user: AuthUser | null;
  hydrating: boolean;
  authError: string | null;
}) {
  useEffect(() => {
    if (pathname === "/") {
      navigate(user ? DEFAULT_AUTHENTICATED_PATH : SIGN_IN_PATH);
    }
  }, [pathname, user]);

  useEffect(() => {
    if (hydrating) {
      return;
    }
    if (authError && pathname !== SIGN_IN_PATH) {
      navigate(SIGN_IN_PATH);
      return;
    }
    if (!user && pathname !== SIGN_IN_PATH) {
      navigate(SIGN_IN_PATH);
      return;
    }
    if (user && pathname === SIGN_IN_PATH && !authError) {
      navigate(DEFAULT_AUTHENTICATED_PATH);
    }
  }, [authError, hydrating, pathname, user]);
}

export function useToastState() {
  const [toasts, setToasts] = useState<AppToast[]>([]);

  useEffect(() => {
    return subscribeToToasts((toast) => {
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 4200);
    });
  }, []);

  return {
    dismissToast: (toastId: string) => {
      setToasts((current) => current.filter((toast) => toast.id !== toastId));
    },
    toasts,
  };
}
