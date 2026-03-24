import { useEffect, useState } from "react";

const FARM_ORDER_PATH_PREFIX = "/farm-orders/";

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

export function navigate(pathname: string) {
  if (window.location.pathname === pathname) {
    return;
  }
  window.history.pushState({}, "", pathname);
  window.dispatchEvent(new Event("app:navigate"));
}

export function isFarmOrderPath(pathname: string): boolean {
  return pathname.startsWith(FARM_ORDER_PATH_PREFIX);
}

export function parseFarmOrderPath(
  pathname: string,
): { workspaceId: string; orderId: string } | null {
  if (!isFarmOrderPath(pathname)) {
    return null;
  }
  const [, workspaceId = "", orderId = ""] = pathname
    .slice(FARM_ORDER_PATH_PREFIX.length)
    .split("/");
  if (!workspaceId || !orderId) {
    return null;
  }
  return {
    workspaceId: decodeURIComponent(workspaceId),
    orderId: decodeURIComponent(orderId),
  };
}

export function buildFarmOrderPath(workspaceId: string, orderId: string): string {
  return `${FARM_ORDER_PATH_PREFIX}${encodeURIComponent(workspaceId)}/${encodeURIComponent(orderId)}`;
}
