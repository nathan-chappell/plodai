import { useEffect, useState } from "react";

export const PLODAI_PATH = "/plodai";
export const ACCOUNT_PATH = "/account";
export const ADMIN_PATH = "/admin";
export const ADMIN_USERS_PATH = ADMIN_PATH;

function currentPathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname || "/";
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(currentPathname);

  useEffect(() => {
    function handleLocationChange() {
      setPathname(currentPathname());
    }

    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("app:navigate", handleLocationChange as EventListener);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("app:navigate", handleLocationChange as EventListener);
    };
  }, []);

  return pathname;
}

export function navigate(pathname: string): void {
  if (window.location.pathname === pathname) {
    return;
  }
  window.history.pushState({}, "", pathname);
  window.dispatchEvent(new Event("app:navigate"));
}

export function isPlodaiPath(pathname: string): boolean {
  return pathname === PLODAI_PATH || pathname.startsWith(`${PLODAI_PATH}/`);
}

export function isAdminUsersPath(pathname: string): boolean {
  return pathname === ADMIN_PATH;
}

export function isAccountPath(pathname: string): boolean {
  return pathname === ACCOUNT_PATH;
}
