import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppState } from "../app/context";
import type { CapabilityDefinition } from "../capabilities/types";
import { AuthPanel } from "./AuthPanel";
import { usePlatformShellState } from "./hooks";
import {
  PlatformBrandBlock,
  PlatformCollapseButton,
  PlatformDropdownMenu,
  PlatformDropdownMenuItem,
  PlatformDropdownTrigger,
  PlatformEyebrow,
  PlatformLayout,
  PlatformMain,
  PlatformNavButton,
  PlatformNavGlyph,
  PlatformNavGrid,
  PlatformNavLabel,
  PlatformNavMeta,
  PlatformPage,
  PlatformSectionTitle,
  PlatformSessionWrap,
  PlatformSidebar,
  PlatformSidebarFooter,
  PlatformSidebarHeader,
  PlatformSidebarPrimary,
  PlatformSidebarSectionIcon,
  PlatformSidebarSection,
  PlatformSubhead,
  PlatformSwatch,
  PlatformSwatchPreview,
  PlatformSwatchRow,
  PlatformThemeModeButton,
  PlatformThemeModeToggle,
  PlatformThemePickerRow,
  PlatformThemeValue,
  PlatformTitle,
} from "./styles";

type ThemePreset = {
  id: string;
  label: string;
  lightValues: Record<string, string>;
  darkValues: Record<string, string>;
};

const THEME_PRESETS: ThemePreset[] = [
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

export function PlatformShell({
  capabilities,
  activeCapabilityId,
  onSelectCapability,
  children,
}: {
  capabilities: CapabilityDefinition[];
  activeCapabilityId: string | null;
  onSelectCapability: (path: string) => void;
  children: ReactNode;
}) {
  const { collapsed, setCollapsed, themeId, setThemeId, themeMode, setThemeMode } =
    usePlatformShellState(THEME_PRESETS);
  const { user } = useAppState();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const activeTheme = THEME_PRESETS.find((theme) => theme.id === themeId) ?? THEME_PRESETS[0];

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <PlatformPage>
      <PlatformLayout $collapsed={collapsed}>
        <PlatformSidebar>
          <PlatformSidebarHeader $collapsed={collapsed}>
            <PlatformBrandBlock $collapsed={collapsed}>
              <PlatformEyebrow>Capability Platform</PlatformEyebrow>
              <PlatformTitle>AI Portfolio</PlatformTitle>
              <PlatformSubhead>Capability-led analysis workspace.</PlatformSubhead>
            </PlatformBrandBlock>
            <PlatformCollapseButton
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((current) => !current)}
              type="button"
            >
              {collapsed ? ">" : "<"}
            </PlatformCollapseButton>
          </PlatformSidebarHeader>

          <PlatformSidebarPrimary>
            <PlatformSidebarSection $collapsed={collapsed}>
              <PlatformSidebarSectionIcon $collapsed={collapsed}>C</PlatformSidebarSectionIcon>
              <PlatformSectionTitle $collapsed={collapsed}>Capabilities</PlatformSectionTitle>
              <PlatformNavGrid>
                {capabilities.map((capability) => (
                  <PlatformNavButton
                    key={capability.id}
                    $active={capability.id === activeCapabilityId}
                    $collapsed={collapsed}
                    onClick={() => onSelectCapability(capability.path)}
                    type="button"
                    title={capability.navLabel}
                  >
                    <PlatformNavGlyph $active={capability.id === activeCapabilityId} />
                    <PlatformNavLabel $collapsed={collapsed}>{capability.navLabel}</PlatformNavLabel>
                    <PlatformNavMeta $collapsed={collapsed}>{capability.description}</PlatformNavMeta>
                  </PlatformNavButton>
                ))}
              </PlatformNavGrid>
            </PlatformSidebarSection>
          </PlatformSidebarPrimary>

          <PlatformSidebarFooter>
            <PlatformSidebarSection $collapsed={collapsed}>
              <PlatformSidebarSectionIcon $collapsed={collapsed}>T</PlatformSidebarSectionIcon>
              <PlatformSectionTitle $collapsed={collapsed}>Theme</PlatformSectionTitle>
              <PlatformThemePickerRow ref={themeMenuRef}>
                <PlatformDropdownTrigger
                  $collapsed={collapsed}
                  aria-expanded={themeMenuOpen}
                  onClick={() => setThemeMenuOpen((current) => !current)}
                  type="button"
                  title={activeTheme.label}
                >
                  <PlatformSwatchPreview>
                    <PlatformSwatch $color={activeTheme.lightValues["--accent"]} />
                    <PlatformSwatch $color={activeTheme.lightValues["--sidebar-bg"]} />
                    <PlatformSwatch $color={activeTheme.lightValues["--bg-bottom"]} />
                  </PlatformSwatchPreview>
                  <PlatformThemeValue $collapsed={collapsed}>{activeTheme.label}</PlatformThemeValue>
                </PlatformDropdownTrigger>
                {themeMenuOpen ? (
                  <PlatformDropdownMenu>
                    {THEME_PRESETS.map((theme) => (
                      <PlatformDropdownMenuItem
                        key={theme.id}
                        $active={theme.id === themeId}
                        onClick={() => {
                          setThemeId(theme.id);
                          setThemeMenuOpen(false);
                        }}
                        type="button"
                      >
                        <PlatformSwatchPreview>
                          <PlatformSwatch $color={theme.lightValues["--accent"]} />
                          <PlatformSwatch $color={theme.lightValues["--sidebar-bg"]} />
                          <PlatformSwatch $color={theme.lightValues["--bg-bottom"]} />
                        </PlatformSwatchPreview>
                        <PlatformThemeValue $collapsed={false}>{theme.label}</PlatformThemeValue>
                      </PlatformDropdownMenuItem>
                    ))}
                  </PlatformDropdownMenu>
                ) : null}
              </PlatformThemePickerRow>
              <PlatformThemeModeToggle $collapsed={collapsed}>
                <PlatformThemeModeButton
                  $active={themeMode === "light"}
                  onClick={() => setThemeMode("light")}
                  type="button"
                >
                  Light
                </PlatformThemeModeButton>
                <PlatformThemeModeButton
                  $active={themeMode === "dark"}
                  onClick={() => setThemeMode("dark")}
                  type="button"
                >
                  Dark
                </PlatformThemeModeButton>
              </PlatformThemeModeToggle>
            </PlatformSidebarSection>
          </PlatformSidebarFooter>
        </PlatformSidebar>

        <PlatformMain>{children}</PlatformMain>
      </PlatformLayout>
    </PlatformPage>
  );
}
