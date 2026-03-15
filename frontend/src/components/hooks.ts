import { useEffect, useState } from "react";

import { readStoredBoolean, readStoredString, writeStoredBoolean, writeStoredString } from "../lib/storage";

const SIDEBAR_STATE_KEY = "ai-portfolio-sidebar-collapsed";
const THEME_KEY = "ai-portfolio-theme";
const THEME_MODE_KEY = "ai-portfolio-theme-mode";

type ThemePreset = {
  id: string;
  label: string;
  lightValues: Record<string, string>;
  darkValues: Record<string, string>;
};

export type ThemeMode = "light" | "dark";

export function usePlatformShellState(themePresets: ThemePreset[]) {
  const [collapsed, setCollapsed] = useState(false);
  const [themeId, setThemeId] = useState(themePresets[0].id);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const savedState = readStoredBoolean(SIDEBAR_STATE_KEY);
    if (savedState) {
      setCollapsed(true);
    }
    const savedThemeId = readStoredString(THEME_KEY);
    if (savedThemeId && themePresets.some((preset) => preset.id === savedThemeId)) {
      setThemeId(savedThemeId);
    }
    const savedThemeMode = readStoredString(THEME_MODE_KEY);
    if (savedThemeMode === "light" || savedThemeMode === "dark") {
      setThemeMode(savedThemeMode);
    }
  }, [themePresets]);

  useEffect(() => {
    writeStoredBoolean(SIDEBAR_STATE_KEY, collapsed);
  }, [collapsed]);

  useEffect(() => {
    const theme = themePresets.find((preset) => preset.id === themeId) ?? themePresets[0];
    const values = themeMode === "dark" ? theme.darkValues : theme.lightValues;
    writeStoredString(THEME_KEY, theme.id);
    writeStoredString(THEME_MODE_KEY, themeMode);
    document.documentElement.style.setProperty("color-scheme", themeMode);
    for (const [name, value] of Object.entries(values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [themeId, themeMode, themePresets]);

  return {
    collapsed,
    setCollapsed,
    themeId,
    setThemeId,
    themeMode,
    setThemeMode,
  };
}
