import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type { AuthUser } from "../types/auth";

type AppState = {
  user: AuthUser | null;
  setUser: Dispatch<SetStateAction<AuthUser | null>>;
  authError: string | null;
  setAuthError: Dispatch<SetStateAction<string | null>>;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AppState;
}) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within AppStateProvider.");
  }
  return context;
}
