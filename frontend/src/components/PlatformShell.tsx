import type { ReactNode } from "react";
import styled from "styled-components";

import type { AuthUser } from "../types/auth";
import type { CapabilityDefinition } from "../capabilities/types";
import { MetaText, displayHeadingCss, panelSurfaceCss } from "../ui/primitives";
import { AuthPanel } from "./AuthPanel";

const Page = styled.main`
  padding: 2rem;
`;

const Shell = styled.div`
  width: min(1400px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
`;

const Topbar = styled.section`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 1.25rem;
  align-items: start;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
`;

const Hero = styled.section`
  ${panelSurfaceCss};
  padding: 2rem;
  border-radius: var(--radius-xl);
  background:
    linear-gradient(140deg, rgba(255, 252, 247, 0.96), rgba(239, 228, 214, 0.92)),
    radial-gradient(circle at top right, rgba(73, 127, 162, 0.16), transparent 34%);
  display: grid;
  gap: 0.9rem;
`;

const Eyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

const Title = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 4.2rem);
  line-height: 0.95;
`;

const Subhead = styled.p`
  margin: 0;
  max-width: 74ch;
  color: var(--muted);
  font-size: 1.02rem;
  line-height: 1.75;
`;

const NavPanel = styled.nav`
  ${panelSurfaceCss};
  padding: 1rem;
  border-radius: var(--radius-xl);
  display: grid;
  gap: 0.75rem;
`;

const NavGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.8rem;
`;

const NavButton = styled.button<{ $active: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.3)" : "var(--line)")};
  background: ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.12)" : "rgba(255, 255, 255, 0.6)")};
  color: var(--ink);
  border-radius: var(--radius-lg);
  padding: 1rem;
  text-align: left;
  display: grid;
  gap: 0.3rem;
  cursor: pointer;
`;

export function PlatformShell({
  user,
  capabilities,
  activeCapabilityId,
  onSelectCapability,
  onAuthenticated,
  children,
}: {
  user: AuthUser | null;
  capabilities: CapabilityDefinition[];
  activeCapabilityId: string | null;
  onSelectCapability: (path: string) => void;
  onAuthenticated: (user: AuthUser | null) => void;
  children: ReactNode;
}) {
  return (
    <Page>
      <Shell>
        <Topbar>
          <Hero>
            <Eyebrow>Agentic Analytics Platform</Eyebrow>
            <Title>Report Foundry</Title>
            <Subhead>
              A capability-driven workspace for investigative AI flows. Each capability gets a consistent shell, typed
              client tools, and a thread-aware ChatKit experience without redoing the page layout from scratch.
            </Subhead>
          </Hero>
          <AuthPanel
            user={user}
            onAuthenticated={onAuthenticated}
            mode={user ? "account" : "login"}
            heading={user ? "Workspace session" : "Sign in"}
            subtitle={
              user
                ? "This shell will later hand off to Clerk, credits, and capability permissions."
                : "Current local auth stays in place while we prepare the platform shell."
            }
          />
        </Topbar>

        <NavPanel>
          <div>
            <strong>Capabilities</strong>
            <MetaText>Start route-based now, then add billing, approval, and richer capability navigation on top.</MetaText>
          </div>
          <NavGrid>
            {capabilities.map((capability) => (
              <NavButton
                key={capability.id}
                $active={capability.id === activeCapabilityId}
                onClick={() => onSelectCapability(capability.path)}
                type="button"
              >
                <strong>{capability.navLabel}</strong>
                <MetaText>{capability.description}</MetaText>
              </NavButton>
            ))}
          </NavGrid>
        </NavPanel>

        {children}
      </Shell>
    </Page>
  );
}
