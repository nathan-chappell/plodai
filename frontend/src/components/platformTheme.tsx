import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { readStoredString, writeStoredString } from "../lib/storage";

const THEME_KEY = "ai-portfolio-theme";
const THEME_MODE_KEY = "ai-portfolio-theme-mode";

export type PlatformThemePreset = {
  id: string;
  label: string;
  lightValues: Record<string, string>;
  darkValues: Record<string, string>;
};

export type PlatformThemeMode = "light" | "dark";

export const PLATFORM_THEME_PRESETS: PlatformThemePreset[] = [
  {
    id: "editorial",
    label: "Editorial",
    lightValues: {
      "--bg-top": "#f6f0e8",
      "--bg-bottom": "#efe6da",
      "--bg-glow-left": "rgba(201, 111, 59, 0.22)",
      "--bg-glow-right": "rgba(73, 127, 162, 0.18)",
      "--panel": "rgba(255, 251, 245, 0.92)",
      "--panel-strong": "#fffdf9",
      "--ink": "#1f2937",
      "--muted": "#5d6b7b",
      "--line": "rgba(31, 41, 55, 0.14)",
      "--accent": "#c96f3b",
      "--accent-deep": "#8f4320",
      "--accent-soft": "rgba(201, 111, 59, 0.14)",
      "--sidebar-bg": "rgba(28, 34, 43, 0.96)",
      "--sidebar-card": "rgba(255, 255, 255, 0.04)",
      "--sidebar-line": "rgba(255, 255, 255, 0.1)",
      "--sidebar-ink": "#f6efe6",
      "--sidebar-muted": "rgba(246, 239, 230, 0.72)",
      "--shadow": "0 20px 60px rgba(53, 39, 28, 0.12)",
    },
    darkValues: {
      "--bg-top": "#12161d",
      "--bg-bottom": "#1b2029",
      "--bg-glow-left": "rgba(201, 111, 59, 0.2)",
      "--bg-glow-right": "rgba(73, 127, 162, 0.16)",
      "--panel": "rgba(28, 32, 41, 0.92)",
      "--panel-strong": "#232935",
      "--ink": "#f3ede4",
      "--muted": "#b2bdcc",
      "--line": "rgba(226, 232, 240, 0.12)",
      "--accent": "#d88a58",
      "--accent-deep": "#efb08b",
      "--accent-soft": "rgba(216, 138, 88, 0.18)",
      "--sidebar-bg": "rgba(13, 16, 22, 0.98)",
      "--sidebar-card": "rgba(255, 255, 255, 0.035)",
      "--sidebar-line": "rgba(255, 255, 255, 0.08)",
      "--sidebar-ink": "#f8f1e7",
      "--sidebar-muted": "rgba(248, 241, 231, 0.68)",
      "--shadow": "0 22px 60px rgba(0, 0, 0, 0.32)",
    },
  },
  {
    id: "coast",
    label: "Coast",
    lightValues: {
      "--bg-top": "#edf4f4",
      "--bg-bottom": "#dde7e8",
      "--bg-glow-left": "rgba(37, 99, 235, 0.12)",
      "--bg-glow-right": "rgba(20, 184, 166, 0.14)",
      "--panel": "rgba(248, 253, 253, 0.92)",
      "--panel-strong": "#fbfeff",
      "--ink": "#1f2937",
      "--muted": "#526273",
      "--line": "rgba(31, 41, 55, 0.12)",
      "--accent": "#0f766e",
      "--accent-deep": "#115e59",
      "--accent-soft": "rgba(15, 118, 110, 0.14)",
      "--sidebar-bg": "rgba(15, 23, 42, 0.97)",
      "--sidebar-card": "rgba(255, 255, 255, 0.045)",
      "--sidebar-line": "rgba(148, 163, 184, 0.16)",
      "--sidebar-ink": "#eff6ff",
      "--sidebar-muted": "rgba(239, 246, 255, 0.7)",
      "--shadow": "0 20px 60px rgba(24, 40, 52, 0.12)",
    },
    darkValues: {
      "--bg-top": "#0f1724",
      "--bg-bottom": "#13202b",
      "--bg-glow-left": "rgba(37, 99, 235, 0.14)",
      "--bg-glow-right": "rgba(20, 184, 166, 0.16)",
      "--panel": "rgba(19, 31, 42, 0.92)",
      "--panel-strong": "#20384b",
      "--ink": "#edf8ff",
      "--muted": "#abc3d1",
      "--line": "rgba(226, 232, 240, 0.11)",
      "--accent": "#33b4a8",
      "--accent-deep": "#74d8cf",
      "--accent-soft": "rgba(51, 180, 168, 0.18)",
      "--sidebar-bg": "rgba(8, 14, 23, 0.98)",
      "--sidebar-card": "rgba(255, 255, 255, 0.03)",
      "--sidebar-line": "rgba(148, 163, 184, 0.12)",
      "--sidebar-ink": "#eff8ff",
      "--sidebar-muted": "rgba(239, 248, 255, 0.66)",
      "--shadow": "0 22px 60px rgba(0, 0, 0, 0.34)",
    },
  },
  {
    id: "ember",
    label: "Ember",
    lightValues: {
      "--bg-top": "#f8efe8",
      "--bg-bottom": "#eddccf",
      "--bg-glow-left": "rgba(234, 88, 12, 0.18)",
      "--bg-glow-right": "rgba(190, 24, 93, 0.12)",
      "--panel": "rgba(255, 249, 244, 0.92)",
      "--panel-strong": "#fffaf4",
      "--ink": "#2b1f1c",
      "--muted": "#715f5c",
      "--line": "rgba(43, 31, 28, 0.12)",
      "--accent": "#d97706",
      "--accent-deep": "#b45309",
      "--accent-soft": "rgba(217, 119, 6, 0.16)",
      "--sidebar-bg": "rgba(41, 20, 18, 0.97)",
      "--sidebar-card": "rgba(255, 248, 240, 0.04)",
      "--sidebar-line": "rgba(251, 191, 36, 0.14)",
      "--sidebar-ink": "#fff7ed",
      "--sidebar-muted": "rgba(255, 247, 237, 0.68)",
      "--shadow": "0 20px 60px rgba(57, 28, 24, 0.13)",
    },
    darkValues: {
      "--bg-top": "#1b1312",
      "--bg-bottom": "#261715",
      "--bg-glow-left": "rgba(234, 88, 12, 0.18)",
      "--bg-glow-right": "rgba(190, 24, 93, 0.12)",
      "--panel": "rgba(42, 27, 24, 0.92)",
      "--panel-strong": "#50312c",
      "--ink": "#fff0e4",
      "--muted": "#d6b9a4",
      "--line": "rgba(255, 237, 213, 0.12)",
      "--accent": "#f59e0b",
      "--accent-deep": "#f7c97a",
      "--accent-soft": "rgba(245, 158, 11, 0.18)",
      "--sidebar-bg": "rgba(20, 10, 9, 0.985)",
      "--sidebar-card": "rgba(255, 248, 240, 0.03)",
      "--sidebar-line": "rgba(251, 191, 36, 0.1)",
      "--sidebar-ink": "#fff5eb",
      "--sidebar-muted": "rgba(255, 245, 235, 0.64)",
      "--shadow": "0 22px 60px rgba(0, 0, 0, 0.35)",
    },
  },
];

type PlatformThemeContextValue = {
  activeTheme: PlatformThemePreset;
  presets: PlatformThemePreset[];
  themeId: string;
  setThemeId: (themeId: string) => void;
  themeMode: PlatformThemeMode;
  setThemeMode: (mode: PlatformThemeMode) => void;
};

const PlatformThemeContext = createContext<PlatformThemeContextValue | null>(null);

export function PlatformThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(PLATFORM_THEME_PRESETS[0].id);
  const [themeMode, setThemeMode] = useState<PlatformThemeMode>("light");

  useEffect(() => {
    const savedThemeId = readStoredString(THEME_KEY);
    if (savedThemeId && PLATFORM_THEME_PRESETS.some((preset) => preset.id === savedThemeId)) {
      setThemeId(savedThemeId);
    }
    const savedThemeMode = readStoredString(THEME_MODE_KEY);
    if (savedThemeMode === "light" || savedThemeMode === "dark") {
      setThemeMode(savedThemeMode);
    }
  }, []);

  const activeTheme =
    PLATFORM_THEME_PRESETS.find((preset) => preset.id === themeId) ?? PLATFORM_THEME_PRESETS[0];

  useEffect(() => {
    const values = themeMode === "dark" ? activeTheme.darkValues : activeTheme.lightValues;
    writeStoredString(THEME_KEY, activeTheme.id);
    writeStoredString(THEME_MODE_KEY, themeMode);
    document.documentElement.style.setProperty("color-scheme", themeMode);
    for (const [name, value] of Object.entries(values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [activeTheme, themeMode]);

  const value = useMemo(
    () => ({
      activeTheme,
      presets: PLATFORM_THEME_PRESETS,
      themeId,
      setThemeId,
      themeMode,
      setThemeMode,
    }),
    [activeTheme, themeId, themeMode],
  );

  return <PlatformThemeContext.Provider value={value}>{children}</PlatformThemeContext.Provider>;
}

export function usePlatformTheme() {
  const context = useContext(PlatformThemeContext);
  if (!context) {
    throw new Error("usePlatformTheme must be used within PlatformThemeProvider.");
  }
  return context;
}
