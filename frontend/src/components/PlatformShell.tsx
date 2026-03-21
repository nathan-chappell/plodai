import type { ReactNode } from "react";
import styled from "styled-components";

import { AuthPanel } from "./AuthPanel";
import type { AgentDefinition } from "../agents/types";
import { PlatformThemeProvider } from "./platformTheme";
import {
  PlatformEyebrow,
  PlatformMain,
  PlatformPage,
} from "./styles";

function BrandMark() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect x="3.5" y="4.25" width="13" height="11.5" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.25 8.25h7.5M6.25 11h5.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function PlatformShell({
  agents,
  activeAgentId,
  onSelectAgent: _onSelectAgent,
  children,
}: {
  agents: AgentDefinition[];
  activeAgentId: string | null;
  onSelectAgent: (path: string) => void;
  children: ReactNode;
}) {
  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;
  const shellTitle = activeAgent?.id === "help-agent" ? "Workspace" : activeAgent?.title ?? "Workspace";

  return (
    <PlatformThemeProvider>
      <PlatformPage>
        <ShellFrame>
          <TopChrome>
            <TopChromeRow>
              <BrandCluster>
                <BrandBlock>
                  <BrandGlyph>
                    <BrandMark />
                  </BrandGlyph>
                  <BrandTextBlock>
                    <PlatformEyebrow>AI Portfolio</PlatformEyebrow>
                    <BrandTitle>{shellTitle}</BrandTitle>
                  </BrandTextBlock>
                </BrandBlock>
              </BrandCluster>

              <TopActions>
                <AccountShell>
                  <AuthPanel mode="account" blendWithShell compact />
                </AccountShell>
              </TopActions>
            </TopChromeRow>

            <MobileUtilityWrap>
              <MobileUtilityPanel>
                <MobileAccountShell>
                  <AuthPanel mode="account" blendWithShell compact />
                </MobileAccountShell>
              </MobileUtilityPanel>
            </MobileUtilityWrap>
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.62rem;
  align-items: center;

  @media (max-width: 740px) {
    gap: 0.52rem;
  }
`;

const BrandGlyph = styled.div`
  width: 1.7rem;
  height: 1.7rem;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 12%, white 88%);
  color: var(--accent-deep);

  svg {
    width: 0.92rem;
    height: 0.92rem;
  }

  @media (max-width: 740px) {
    width: 1.62rem;
    height: 1.62rem;
    border-radius: 11px;

    svg {
      width: 0.84rem;
      height: 0.84rem;
    }
  }
`;

const BrandTextBlock = styled.div`
  display: grid;
  gap: 0.08rem;
`;

const BrandTitle = styled.h1`
  margin: 0;
  font-size: clamp(0.98rem, 1.3vw, 1.18rem);
  line-height: 1.02;
  color: var(--ink);

  @media (max-width: 740px) {
    font-size: 0.92rem;
  }
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

const MobileUtilityWrap = styled.div`
  display: none;

  @media (max-width: 740px) {
    display: block;
    margin-top: 0.42rem;
  }
`;

const MobileUtilityPanel = styled.div`
  display: grid;
  gap: 0.35rem;
  padding: 0.12rem 0 0;
`;

const MobileAccountShell = styled.div`
  width: 100%;

  > div {
    padding: 0;
  }
`;
