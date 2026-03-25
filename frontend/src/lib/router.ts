import { useEffect, useState } from "react";

export const PLODAI_PATH = "/plodai";
export const ADMIN_USERS_PATH = "/admin/users";
const FARM_ORDER_PATH_PREFIX = "/farms/";

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
  return pathname === ADMIN_USERS_PATH;
}

export function isFarmOrderPath(pathname: string): boolean {
  return /^\/farms\/[^/]+\/orders\/[^/]+$/.test(pathname);
}

export function parseFarmOrderPath(
  pathname: string,
): { farmId: string; orderId: string } | null {
  if (!isFarmOrderPath(pathname)) {
    return null;
  }
  const [, , farmId = "", , orderId = ""] = pathname.split("/");
  if (!farmId || !orderId) {
    return null;
  }
  return {
    farmId: decodeURIComponent(farmId),
    orderId: decodeURIComponent(orderId),
  };
}

export function buildFarmOrderPath(farmId: string, orderId: string): string {
  return `${FARM_ORDER_PATH_PREFIX}${encodeURIComponent(farmId)}/orders/${encodeURIComponent(orderId)}`;
}
