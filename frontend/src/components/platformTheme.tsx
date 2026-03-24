import { useEffect, type ReactNode } from "react";

type PlatformThemeValues = {
  "--bg-top": string;
  "--bg-bottom": string;
  "--bg-glow-left": string;
  "--bg-glow-right": string;
  "--panel": string;
  "--panel-strong": string;
  "--ink": string;
  "--muted": string;
  "--line": string;
  "--accent": string;
  "--accent-deep": string;
  "--accent-soft": string;
  "--sidebar-bg": string;
  "--sidebar-card": string;
  "--sidebar-line": string;
  "--sidebar-ink": string;
  "--sidebar-muted": string;
  "--shadow": string;
};

const BASE_THEME_VALUES: PlatformThemeValues = {
  "--bg-top": "#f6f0e8",
  "--bg-bottom": "#efe6da",
  "--bg-glow-left": "rgba(201, 111, 59, 0.18)",
  "--bg-glow-right": "rgba(73, 127, 162, 0.14)",
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
};

const AGENT_THEME_OVERRIDES: Record<string, Partial<PlatformThemeValues>> = {
  "report-agent": {
    "--bg-top": "#eef4ff",
    "--bg-bottom": "#e5edf9",
    "--bg-glow-left": "rgba(37, 99, 235, 0.16)",
    "--bg-glow-right": "rgba(56, 189, 248, 0.12)",
    "--accent": "#2563eb",
    "--accent-deep": "#1d4ed8",
    "--accent-soft": "rgba(37, 99, 235, 0.14)",
    "--sidebar-bg": "rgba(22, 35, 63, 0.96)",
    "--sidebar-line": "rgba(191, 219, 254, 0.14)",
    "--sidebar-ink": "#eff6ff",
    "--sidebar-muted": "rgba(239, 246, 255, 0.74)",
    "--shadow": "0 20px 60px rgba(37, 99, 235, 0.1)",
  },
  "document-agent": {
    "--bg-top": "#f4efff",
    "--bg-bottom": "#ebe4fb",
    "--bg-glow-left": "rgba(124, 58, 237, 0.16)",
    "--bg-glow-right": "rgba(168, 85, 247, 0.1)",
    "--accent": "#7c3aed",
    "--accent-deep": "#6d28d9",
    "--accent-soft": "rgba(124, 58, 237, 0.14)",
    "--sidebar-bg": "rgba(39, 24, 58, 0.96)",
    "--sidebar-line": "rgba(221, 214, 254, 0.14)",
    "--sidebar-ink": "#f5f3ff",
    "--sidebar-muted": "rgba(245, 243, 255, 0.72)",
    "--shadow": "0 20px 60px rgba(109, 40, 217, 0.1)",
  },
  "plodai-agent": {
    "--bg-top": "#edf6ee",
    "--bg-bottom": "#e1eddf",
    "--bg-glow-left": "rgba(22, 163, 74, 0.14)",
    "--bg-glow-right": "rgba(132, 204, 22, 0.1)",
    "--accent": "#15803d",
    "--accent-deep": "#166534",
    "--accent-soft": "rgba(21, 128, 61, 0.14)",
    "--sidebar-bg": "rgba(22, 40, 26, 0.96)",
    "--sidebar-line": "rgba(187, 247, 208, 0.12)",
    "--sidebar-ink": "#f0fdf4",
    "--sidebar-muted": "rgba(240, 253, 244, 0.72)",
    "--shadow": "0 20px 60px rgba(21, 128, 61, 0.1)",
  },
};

export function hasAgentTheme(agentId: string | null | undefined): boolean {
  return Boolean(agentId && AGENT_THEME_OVERRIDES[agentId]);
}

function resolveThemeValues(agentId: string | null | undefined): PlatformThemeValues {
  return {
    ...BASE_THEME_VALUES,
    ...(agentId ? AGENT_THEME_OVERRIDES[agentId] ?? {} : {}),
  };
}

export function PlatformThemeProvider({
  agentId,
  children,
}: {
  agentId?: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    const values = resolveThemeValues(agentId);
    document.documentElement.style.setProperty("color-scheme", "light");
    for (const [name, value] of Object.entries(values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [agentId]);

  return <>{children}</>;
}
