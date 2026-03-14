import { useEffect, useState } from "react";

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
