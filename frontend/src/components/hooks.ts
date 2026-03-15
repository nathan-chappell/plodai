import { useEffect, useState } from "react";

import { readStoredBoolean, readStoredString, writeStoredBoolean, writeStoredString } from "../lib/storage";

const SIDEBAR_STATE_KEY = "ai-portfolio-sidebar-collapsed";
const THEME_KEY = "ai-portfolio-theme";

type ThemePreset = {
  id: string;
  label: string;
  values: Record<string, string>;
};

export function usePlatformShellState(themePresets: ThemePreset[]) {
  const [collapsed, setCollapsed] = useState(false);
  const [themeId, setThemeId] = useState(themePresets[0].id);

  useEffect(() => {
    const savedState = readStoredBoolean(SIDEBAR_STATE_KEY);
    if (savedState) {
      setCollapsed(true);
    }
    const savedThemeId = readStoredString(THEME_KEY);
    if (savedThemeId && themePresets.some((preset) => preset.id === savedThemeId)) {
      setThemeId(savedThemeId);
    }
  }, [themePresets]);

  useEffect(() => {
    writeStoredBoolean(SIDEBAR_STATE_KEY, collapsed);
  }, [collapsed]);

  useEffect(() => {
    const theme = themePresets.find((preset) => preset.id === themeId) ?? themePresets[0];
    writeStoredString(THEME_KEY, theme.id);
    for (const [name, value] of Object.entries(theme.values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [themeId, themePresets]);

  return {
    collapsed,
    setCollapsed,
    themeId,
    setThemeId,
  };
}
