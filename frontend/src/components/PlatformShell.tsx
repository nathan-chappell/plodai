import type { ReactNode } from "react";

import { useAppState } from "../app/context";
import type { CapabilityDefinition } from "../capabilities/types";
import { AuthPanel } from "./AuthPanel";
import { usePlatformShellState } from "./hooks";
import {
  PlatformBrandBlock,
  PlatformCollapseButton,
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
  PlatformSidebarHeader,
  PlatformSidebarSectionIcon,
  PlatformSidebarMeta,
  PlatformSidebarSection,
  PlatformSubhead,
  PlatformSwatch,
  PlatformSwatchRow,
  PlatformThemeButton,
  PlatformThemeLabel,
  PlatformThemeList,
  PlatformTitle,
} from "./styles";

type ThemePreset = {
  id: string;
  label: string;
  values: Record<string, string>;
};

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "editorial",
    label: "Editorial",
    values: {
      "--bg-top": "#f6f0e8",
      "--bg-bottom": "#efe6da",
      "--bg-glow-left": "rgba(201, 111, 59, 0.22)",
      "--bg-glow-right": "rgba(73, 127, 162, 0.18)",
      "--accent": "#c96f3b",
      "--accent-deep": "#8f4320",
      "--accent-soft": "rgba(201, 111, 59, 0.14)",
      "--sidebar-bg": "rgba(28, 34, 43, 0.96)",
      "--sidebar-card": "rgba(255, 255, 255, 0.04)",
      "--sidebar-line": "rgba(255, 255, 255, 0.1)",
      "--sidebar-ink": "#f6efe6",
      "--sidebar-muted": "rgba(246, 239, 230, 0.72)",
    },
  },
  {
    id: "coast",
    label: "Coast",
    values: {
      "--bg-top": "#edf4f4",
      "--bg-bottom": "#dde7e8",
      "--bg-glow-left": "rgba(37, 99, 235, 0.12)",
      "--bg-glow-right": "rgba(20, 184, 166, 0.14)",
      "--accent": "#0f766e",
      "--accent-deep": "#115e59",
      "--accent-soft": "rgba(15, 118, 110, 0.14)",
      "--sidebar-bg": "rgba(15, 23, 42, 0.97)",
      "--sidebar-card": "rgba(255, 255, 255, 0.045)",
      "--sidebar-line": "rgba(148, 163, 184, 0.16)",
      "--sidebar-ink": "#eff6ff",
      "--sidebar-muted": "rgba(239, 246, 255, 0.7)",
    },
  },
  {
    id: "ember",
    label: "Ember",
    values: {
      "--bg-top": "#f8efe8",
      "--bg-bottom": "#eddccf",
      "--bg-glow-left": "rgba(234, 88, 12, 0.18)",
      "--bg-glow-right": "rgba(190, 24, 93, 0.12)",
      "--accent": "#d97706",
      "--accent-deep": "#b45309",
      "--accent-soft": "rgba(217, 119, 6, 0.16)",
      "--sidebar-bg": "rgba(41, 20, 18, 0.97)",
      "--sidebar-card": "rgba(255, 248, 240, 0.04)",
      "--sidebar-line": "rgba(251, 191, 36, 0.14)",
      "--sidebar-ink": "#fff7ed",
      "--sidebar-muted": "rgba(255, 247, 237, 0.68)",
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
  const { collapsed, setCollapsed, themeId, setThemeId } = usePlatformShellState(THEME_PRESETS);
  const { user } = useAppState();

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

          <PlatformSidebarSection $collapsed={collapsed}>
            <PlatformSidebarSectionIcon $collapsed={collapsed}>U</PlatformSidebarSectionIcon>
            <PlatformSectionTitle $collapsed={collapsed}>Session</PlatformSectionTitle>
            <PlatformSessionWrap $collapsed={collapsed}>
              <AuthPanel mode="account" heading="Account" subtitle="Signed-in workspace session." />
            </PlatformSessionWrap>
          </PlatformSidebarSection>

          <PlatformSidebarSection $collapsed={collapsed}>
            <PlatformSidebarSectionIcon $collapsed={collapsed}>T</PlatformSidebarSectionIcon>
            <PlatformSectionTitle $collapsed={collapsed}>Theme</PlatformSectionTitle>
            <PlatformThemeList>
              {THEME_PRESETS.map((theme) => (
                <PlatformThemeButton
                  key={theme.id}
                  $active={theme.id === themeId}
                  $collapsed={collapsed}
                  onClick={() => setThemeId(theme.id)}
                  type="button"
                  title={theme.label}
                >
                  <PlatformSwatchRow $collapsed={collapsed}>
                    <PlatformSwatch $color={theme.values["--accent"]} />
                    <PlatformSwatch $color={theme.values["--sidebar-bg"]} />
                    <PlatformSwatch $color={theme.values["--bg-bottom"]} />
                  </PlatformSwatchRow>
                  <PlatformThemeLabel $collapsed={collapsed}>{theme.label}</PlatformThemeLabel>
                </PlatformThemeButton>
              ))}
            </PlatformThemeList>
          </PlatformSidebarSection>
        </PlatformSidebar>

        <PlatformMain>{children}</PlatformMain>
      </PlatformLayout>
    </PlatformPage>
  );
}
