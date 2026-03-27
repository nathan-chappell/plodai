import type { ReactNode } from "react";
import styled from "styled-components";

import { useMediaQuery } from "../app/hooks";
import { useAppState } from "../app/context";
import { AuthPanel } from "./AuthPanel";
import { BRAND_MARK_URL } from "../lib/brand";
import { PlatformThemeProvider } from "./platformTheme";
import { COMPACT_WORKSPACE_MEDIA_QUERY } from "../lib/responsive";
import { ADMIN_USERS_PATH, PLODAI_PATH, navigate } from "../lib/router";
import { PlatformMain, PlatformPage } from "./styles";

export function PlatformShell({
  title,
  activePath,
  canViewAdmin = false,
  children,
}: {
  title: string;
  activePath: string;
  canViewAdmin?: boolean;
  children: ReactNode;
}) {
  const { preferredOutputLanguage, setPreferredOutputLanguage } = useAppState();
  const isCompactWorkspace = useMediaQuery(COMPACT_WORKSPACE_MEDIA_QUERY);
  const hideShellWorkspaceControls = activePath === PLODAI_PATH && isCompactWorkspace;

  return (
    <PlatformThemeProvider agentId="plodai-agent">
      <PlatformPage>
        <ShellFrame>
          <TopChrome>
            <TopChromeRow>
              <BrandCluster>
                <BrandBlock>
                  <BrandLogo alt="" aria-hidden="true" data-testid="shell-logo" src={BRAND_MARK_URL} />
                  <BrandTitle>{title}</BrandTitle>
                </BrandBlock>
                {!hideShellWorkspaceControls ? (
                  <NavRow>
                    <NavButton
                      $active={activePath === PLODAI_PATH}
                      onClick={() => navigate(PLODAI_PATH)}
                      type="button"
                    >
                      Farms
                    </NavButton>
                    {canViewAdmin ? (
                      <NavButton
                        $active={activePath === ADMIN_USERS_PATH}
                        onClick={() => navigate(ADMIN_USERS_PATH)}
                        type="button"
                      >
                        Admin
                      </NavButton>
                    ) : null}
                  </NavRow>
                ) : null}
              </BrandCluster>

              <TopActions>
                {!hideShellWorkspaceControls ? (
                  <HeaderLanguageToggle aria-label="Preferred reply language">
                    <LanguageToggleButton
                      $active={preferredOutputLanguage === "hr"}
                      onClick={() => setPreferredOutputLanguage("hr")}
                      type="button"
                    >
                      HR
                    </LanguageToggleButton>
                    <LanguageToggleButton
                      $active={preferredOutputLanguage === "en"}
                      onClick={() => setPreferredOutputLanguage("en")}
                      type="button"
                    >
                      EN
                    </LanguageToggleButton>
                  </HeaderLanguageToggle>
                ) : null}
                {!hideShellWorkspaceControls ? (
                  <AccountShell>
                    <AuthPanel mode="account" blendWithShell compact />
                  </AccountShell>
                ) : null}
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
  gap: 0.5rem;
  padding: 0.55rem;

  @media (max-width: 1100px) {
    height: auto;
  }

  @media (max-width: 740px) {
    gap: 0.45rem;
    padding: 0.45rem;
  }
`;

const TopChrome = styled.header`
  padding: 0.36rem 0.48rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(249, 244, 238, 0.92)),
    var(--panel);
  box-shadow: 0 10px 24px rgba(32, 26, 20, 0.06);
`;

const TopChromeRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.55rem;
  align-items: center;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

const BrandCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  flex-wrap: wrap;
`;

const BrandBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
`;

const BrandLogo = styled.img`
  width: 1.55rem;
  height: 1.55rem;
  flex: 0 0 auto;
  display: block;
  object-fit: contain;
`;

const BrandTitle = styled.h1`
  margin: 0;
  font-size: clamp(0.92rem, 1.1vw, 1.05rem);
  line-height: 1;
  color: var(--ink);
  letter-spacing: -0.02em;
`;

const NavRow = styled.div`
  display: flex;
  gap: 0.28rem;
  flex-wrap: wrap;
`;

const NavButton = styled.button<{ $active?: boolean }>`
  appearance: none;
  border: 1px solid ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.28)" : "var(--line)")};
  background: ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.12)" : "rgba(255, 255, 255, 0.74)")};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--ink)")};
  border-radius: 999px;
  min-height: 1.7rem;
  padding: 0.2rem 0.52rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
`;

const TopActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;

  @media (max-width: 740px) {
    justify-content: space-between;
  }
`;

const HeaderLanguageToggle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.12rem;
  padding: 0.14rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.76);
`;

const LanguageToggleButton = styled.button<{ $active: boolean }>`
  appearance: none;
  border: 0;
  border-radius: 999px;
  min-width: 2.2rem;
  min-height: 1.8rem;
  padding: 0.18rem 0.52rem;
  background: ${({ $active }) => ($active ? "rgba(21, 128, 61, 0.12)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--muted)")};
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1;
  cursor: pointer;
`;

const AccountShell = styled.div`
  min-width: min(420px, 100%);
  justify-self: end;

  @media (max-width: 740px) {
    display: none;
  }
`;
