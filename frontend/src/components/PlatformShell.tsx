import { useEffect, useState, type ReactNode } from "react";
import styled from "styled-components";

import type { AuthUser } from "../types/auth";
import type { CapabilityDefinition } from "../capabilities/types";
import { MetaText, displayHeadingCss, panelSurfaceCss } from "../ui/primitives";
import { AuthPanel } from "./AuthPanel";

const SIDEBAR_STATE_KEY = "ai-portfolio-sidebar-collapsed";
const THEME_KEY = "ai-portfolio-theme";

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

const Page = styled.main`
  width: 100%;
  padding: 0;

  @media (max-width: 1100px) {
    padding: 0.75rem;
  }
`;

const Shell = styled.div<{ $collapsed: boolean }>`
  width: 100%;
  min-height: 100vh;
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "92px" : "300px")} minmax(0, 1fr);
  gap: 0;
  align-items: start;
  transition: grid-template-columns 240ms ease;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
`;

const Sidebar = styled.aside`
  position: sticky;
  top: 1rem;
  min-height: calc(100vh - 2rem);
  padding: 1rem 0.85rem;
  border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 18%),
    var(--sidebar-bg);
  color: var(--sidebar-ink);
  display: grid;
  gap: 0.8rem;
  box-shadow: 0 22px 60px rgba(10, 10, 10, 0.16);
  border: 1px solid var(--sidebar-line);
  transition: background 240ms ease, padding 220ms ease, box-shadow 240ms ease;

  @media (max-width: 1100px) {
    position: static;
    min-height: auto;
    border-radius: var(--radius-xl);
  }
`;

const Main = styled.div`
  min-width: 0;
  display: grid;
  gap: 1.25rem;
  padding: 1rem;
  animation: fadeSlideIn 260ms ease;

  @media (max-width: 1100px) {
    padding: 0;
  }
`;

const SidebarHeader = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
`;

const BrandBlock = styled.div<{ $collapsed: boolean }>`
  min-width: 0;
  display: grid;
  gap: 0.4rem;
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  transform: ${({ $collapsed }) => ($collapsed ? "translateX(-6px)" : "translateX(0)")};
  transition: opacity 180ms ease, transform 180ms ease;
  pointer-events: ${({ $collapsed }) => ($collapsed ? "none" : "auto")};
`;

const Eyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sidebar-muted);
  font-size: 0.72rem;
`;

const Title = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: 1.45rem;
  line-height: 1;
  color: var(--sidebar-ink);
`;

const Subhead = styled.p`
  margin: 0;
  color: var(--sidebar-muted);
  font-size: 0.9rem;
  line-height: 1.55;
`;

const CollapseButton = styled.button`
  border: 1px solid var(--sidebar-line);
  background: var(--sidebar-card);
  color: var(--sidebar-ink);
  border-radius: 999px;
  width: 2.25rem;
  height: 2.25rem;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;

  &:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.08);
  }
`;

const SidebarSection = styled.section<{ $collapsed?: boolean }>`
  padding: 0.85rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--sidebar-line);
  background: var(--sidebar-card);
  display: grid;
  gap: 0.7rem;
  overflow: hidden;
  transition: background 220ms ease, border-color 220ms ease, padding 220ms ease;
`;

const SectionTitle = styled.div<{ $collapsed?: boolean }>`
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sidebar-ink);
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 0.86)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "28px")};
  transform: ${({ $collapsed }) => ($collapsed ? "translateY(-4px)" : "translateY(0)")};
  transition: opacity 180ms ease, max-height 180ms ease, transform 180ms ease;
`;

const NavGrid = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const NavButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid
    ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 46%, white 8%)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--sidebar-ink)" : "var(--sidebar-muted)")};
  border-radius: 16px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.7rem 0.55rem" : "0.8rem 0.85rem")};
  text-align: left;
  display: grid;
  gap: 0.2rem;
  cursor: pointer;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    padding 180ms ease;

  &:hover {
    transform: translateX(2px);
  }
`;

const NavLabel = styled.strong<{ $collapsed: boolean }>`
  font-size: 0.98rem;
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "32px")};
  transition: opacity 180ms ease, max-height 180ms ease;
`;

const NavMeta = styled(MetaText)<{ $collapsed: boolean }>`
  color: var(--sidebar-muted);
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "60px")};
  transition: opacity 180ms ease, max-height 180ms ease;
`;

const NavGlyph = styled.span<{ $active: boolean }>`
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: ${({ $active }) => ($active ? "var(--accent)" : "rgba(255,255,255,0.18)")};
  transition: background 180ms ease, transform 180ms ease;
`;

const SessionWrap = styled.div`
  > section {
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0;
    color: var(--sidebar-ink);
  }

  h2,
  strong,
  label {
    color: var(--sidebar-ink);
  }

  p,
  div {
    color: var(--sidebar-muted);
  }
`;

const ThemeList = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const ThemeButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "var(--accent)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: var(--sidebar-ink);
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.55rem" : "0.65rem 0.75rem")};
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "auto minmax(0, 1fr)")};
  gap: 0.6rem;
  align-items: center;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;

  &:hover {
    transform: translateX(2px);
  }
`;

const SwatchRow = styled.div`
  display: flex;
  gap: 0.35rem;
`;

const Swatch = styled.span<{ $color: string }>`
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 999px;
  background: ${({ $color }) => $color};
  border: 1px solid rgba(255, 255, 255, 0.18);
`;

const ThemeLabel = styled.span<{ $collapsed: boolean }>`
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "24px")};
  transition: opacity 180ms ease, max-height 180ms ease;
`;

const SidebarMeta = styled(MetaText)<{ $collapsed?: boolean }>`
  color: var(--sidebar-muted);
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "120px")};
  transition: opacity 180ms ease, max-height 180ms ease;
`;

export function PlatformShell({
  user,
  capabilities,
  activeCapabilityId,
  onSelectCapability,
  onAuthenticated,
  children,
}: {
  user: AuthUser;
  capabilities: CapabilityDefinition[];
  activeCapabilityId: string | null;
  onSelectCapability: (path: string) => void;
  onAuthenticated: (user: AuthUser | null) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [themeId, setThemeId] = useState(THEME_PRESETS[0].id);

  useEffect(() => {
    const savedState = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (savedState === "true") {
      setCollapsed(true);
    }
    const savedThemeId = window.localStorage.getItem(THEME_KEY);
    if (savedThemeId && THEME_PRESETS.some((preset) => preset.id === savedThemeId)) {
      setThemeId(savedThemeId);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const theme = THEME_PRESETS.find((preset) => preset.id === themeId) ?? THEME_PRESETS[0];
    window.localStorage.setItem(THEME_KEY, theme.id);
    for (const [name, value] of Object.entries(theme.values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [themeId]);

  return (
    <Page>
      <Shell $collapsed={collapsed}>
        <Sidebar>
          <SidebarHeader $collapsed={collapsed}>
            <BrandBlock $collapsed={collapsed}>
              <Eyebrow>Agentic Analytics Platform</Eyebrow>
              <Title>AI Portfolio</Title>
              <Subhead>
                Capability-led workspace shell with reusable client tools, thread memory, and room for auth, credits,
                and billing.
              </Subhead>
            </BrandBlock>
            <CollapseButton
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((current) => !current)}
              type="button"
            >
              {collapsed ? ">" : "<"}
            </CollapseButton>
          </SidebarHeader>

          <SidebarSection $collapsed={collapsed}>
            <SectionTitle $collapsed={collapsed}>Capabilities</SectionTitle>
            <SidebarMeta $collapsed={collapsed}>
              Start route-based now, then add billing, approvals, and richer capability-local navigation.
            </SidebarMeta>
            <NavGrid>
              {capabilities.map((capability) => (
                <NavButton
                  key={capability.id}
                  $active={capability.id === activeCapabilityId}
                  $collapsed={collapsed}
                  onClick={() => onSelectCapability(capability.path)}
                  type="button"
                  title={capability.navLabel}
                >
                  <NavGlyph $active={capability.id === activeCapabilityId} />
                  <NavLabel $collapsed={collapsed}>{capability.navLabel}</NavLabel>
                  <NavMeta $collapsed={collapsed}>{capability.description}</NavMeta>
                </NavButton>
              ))}
            </NavGrid>
          </SidebarSection>

          <SidebarSection $collapsed={collapsed}>
            <SectionTitle $collapsed={collapsed}>Session</SectionTitle>
            <SessionWrap>
              <AuthPanel
                user={user}
                onAuthenticated={onAuthenticated}
                mode="account"
                heading="Session"
                subtitle="Clerk, credits, and billing will plug into this rail."
              />
            </SessionWrap>
          </SidebarSection>

          <SidebarSection $collapsed={collapsed}>
            <SectionTitle $collapsed={collapsed}>Theme</SectionTitle>
            <ThemeList>
              {THEME_PRESETS.map((theme) => (
                <ThemeButton
                  key={theme.id}
                  $active={theme.id === themeId}
                  $collapsed={collapsed}
                  onClick={() => setThemeId(theme.id)}
                  type="button"
                  title={theme.label}
                >
                  <SwatchRow>
                    <Swatch $color={theme.values["--accent"]} />
                    <Swatch $color={theme.values["--sidebar-bg"]} />
                    <Swatch $color={theme.values["--bg-bottom"]} />
                  </SwatchRow>
                  <ThemeLabel $collapsed={collapsed}>{theme.label}</ThemeLabel>
                </ThemeButton>
              ))}
            </ThemeList>
            <SidebarMeta $collapsed={collapsed}>
              These presets drive shared CSS variables so shell colors update without restyling individual pages.
            </SidebarMeta>
          </SidebarSection>
        </Sidebar>

        <Main>{children}</Main>
      </Shell>
    </Page>
  );
}
