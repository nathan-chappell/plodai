import type { ReactNode } from "react";
import styled from "styled-components";

import { AuthPanel } from "./AuthPanel";
import type { AgentDefinition } from "../agents/types";
import { getAgentDefinition } from "../agents/definitions";
import { hasAgentTheme, PlatformThemeProvider } from "./platformTheme";
import { PlatformMain, PlatformPage } from "./styles";

export function PlatformShell({
  agents: _agents,
  activeAgentId: _activeAgentId,
  themeAgentId,
  onSelectAgent: _onSelectAgent,
  children,
}: {
  agents: AgentDefinition[];
  activeAgentId: string | null;
  themeAgentId?: string | null;
  onSelectAgent: (path: string) => void;
  children: ReactNode;
}) {
  const themedAgent = themeAgentId ? getAgentDefinition(themeAgentId) : null;
  const modeLabel = themedAgent && hasAgentTheme(themedAgent.id) ? themedAgent.title : null;

  return (
    <PlatformThemeProvider agentId={themeAgentId}>
      <PlatformPage>
        <ShellFrame>
          <TopChrome>
            <TopChromeRow>
              <BrandCluster>
                <BrandBlock>
                  <BrandTitle>AI Portfolio</BrandTitle>
                  {modeLabel ? <BrandModePill>{modeLabel}</BrandModePill> : null}
                </BrandBlock>
              </BrandCluster>

              <TopActions>
                <AccountShell>
                  <AuthPanel mode="account" blendWithShell compact />
                </AccountShell>
              </TopActions>
            </TopChromeRow>
          </TopChrome>

          <PlatformMain>{children}</PlatformMain>
        </ShellFrame>
      </PlatformPage>
    </PlatformThemeProvider>
  );
}

const ShellFrame = styled.div`
  width: 100%;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.7rem;
  padding: 0.72rem;

  @media (max-width: 1100px) {
    height: auto;
  }

  @media (max-width: 740px) {
    gap: 0.6rem;
    padding: 0.55rem;
  }
`;

const TopChrome = styled.header`
  padding: 0.58rem 0.72rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(249, 244, 238, 0.92)),
    var(--panel);
  box-shadow: 0 14px 32px rgba(32, 26, 20, 0.08);

  @media (max-width: 740px) {
    padding: 0.48rem 0.56rem;
  }
`;

const TopChromeRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }

  @media (max-width: 740px) {
    gap: 0.4rem;
  }
`;

const BrandCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  flex-wrap: wrap;

  @media (max-width: 740px) {
    gap: 0.55rem;
    align-items: center;
    flex-wrap: nowrap;
  }
`;

const BrandBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 0.62rem;
  min-width: 0;

  @media (max-width: 740px) {
    gap: 0.52rem;
  }
`;

const BrandTitle = styled.h1`
  margin: 0;
  font-size: clamp(1.02rem, 1.35vw, 1.2rem);
  line-height: 1.02;
  color: var(--ink);
  letter-spacing: -0.02em;

  @media (max-width: 740px) {
    font-size: 0.94rem;
  }
`;

const BrandModePill = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.85rem;
  padding: 0.36rem 0.78rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, rgba(31, 41, 55, 0.08));
  background: color-mix(in srgb, var(--accent) 10%, white 90%);
  color: var(--accent-deep);
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
`;

const TopActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;

  @media (max-width: 740px) {
    display: none;
  }
`;

const AccountShell = styled.div`
  min-width: min(500px, 100%);
  justify-self: end;

  @media (max-width: 1180px) {
    min-width: 0;
    justify-self: stretch;
  }

  @media (max-width: 740px) {
    width: 100%;
  }
`;
