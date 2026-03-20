import { useEffect, useState } from "react";

import { readStoredBoolean, writeStoredBoolean } from "../lib/storage";

const SIDEBAR_STATE_KEY = "ai-portfolio-sidebar-collapsed";

export function usePlatformShellState() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (readStoredBoolean(SIDEBAR_STATE_KEY)) {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    writeStoredBoolean(SIDEBAR_STATE_KEY, collapsed);
  }, [collapsed]);

  return {
    collapsed,
    setCollapsed,
  };
}
