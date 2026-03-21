import styled from "styled-components";

import {
  MetaText,
  displayHeadingCss,
  emptyStateCss,
  flexWrapRowCss,
  gridStackCss,
  panelSurfaceCss,
  primaryButtonCss,
  secondaryButtonCss,
  sectionPanelCss,
  stackedListCss,
  strongSurfaceCss,
  tableBodyCellCss,
  tableHeaderCellCss,
  warmSurfaceCss,
} from "../app/styles";
import { css } from "styled-components";

const CardSection = styled.section`
  ${sectionPanelCss()};
`;

const WrapRow = styled.div`
  ${flexWrapRowCss()};
`;

const SecondaryActionButton = styled.button`
  ${secondaryButtonCss};
`;

const OverlayMetaText = styled.p`
  margin: 0;
  color: rgba(248, 246, 242, 0.74);
  line-height: 1.6;
`;

const SidebarSurfaceSection = styled.section<{ $collapsed?: boolean }>`
  padding: ${({ $collapsed }) => ($collapsed ? "0.42rem" : "0.58rem")};
  border-radius: 18px;
  border: 1px solid var(--sidebar-line);
  background: var(--sidebar-card);
  ${gridStackCss("0.4rem")};
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
  overflow: hidden;
  transition: background 220ms ease, border-color 220ms ease, padding 220ms ease;
`;

const sidebarFadingMetaCss = (maxHeight: string) => css<{ $collapsed?: boolean }>`
  color: var(--sidebar-muted);
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : maxHeight)};
  transition: opacity 180ms ease, max-height 180ms ease;
`;

const TableScroller = styled.div`
  overflow-x: auto;
`;

const PlainTable = styled.table`
  border-collapse: collapse;
`;

export const SignInPageRoot = styled.main`
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 2rem;
`;

export const SignInShell = styled.div`
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 420px);
  gap: 1.25rem;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

export const SignInHero = styled.section`
  ${sectionPanelCss("2rem")};
  border-radius: var(--radius-xl);
  background:
    linear-gradient(145deg, rgba(255, 252, 247, 0.96), rgba(239, 228, 214, 0.92)),
    radial-gradient(circle at top right, rgba(73, 127, 162, 0.14), transparent 34%);
`;

export const SignInEyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

export const SignInTitle = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 4.2rem);
  line-height: 0.96;
`;

export const SignInSubhead = styled.p`
  margin: 0;
  max-width: 58ch;
  color: var(--muted);
  font-size: 1.04rem;
  line-height: 1.75;
`;

export const SignInFeatureList = styled.ul`
  margin: 0;
  padding-left: 1.1rem;
  ${gridStackCss("0.65rem")};
  color: var(--ink);
`;

export const SignInCard = styled(CardSection)`
  border-radius: var(--radius-xl);
  align-self: start;
`;

export const SignInErrorCard = styled(SignInCard)`
  border-color: color-mix(in srgb, var(--accent-deep) 26%, rgba(31, 41, 55, 0.12));
  background:
    linear-gradient(145deg, rgba(255, 247, 241, 0.96), rgba(244, 231, 220, 0.92)),
    radial-gradient(circle at top right, rgba(201, 111, 59, 0.14), transparent 34%);
`;

export const SignInButtonRow = styled(WrapRow)``;

export const SignInErrorActions = styled(WrapRow)``;

export const SignInActionButton = styled.button`
  ${primaryButtonCss};
  background: var(--ink);
`;

export const SignInSecondaryActionButton = styled.button`
  ${secondaryButtonCss};
  padding: 0.72rem 1rem;
`;

export const AccountCard = styled(CardSection)<{ $blend?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.35rem 0.9rem;
  align-self: start;
  padding: ${({ $blend }) => ($blend ? "0" : "0.42rem 0.62rem")};
  border-radius: 18px;
  border-color: ${({ $blend }) => ($blend ? "transparent" : "var(--line)")};
  background: ${({ $blend }) => ($blend ? "transparent" : "var(--panel)")};
  box-shadow: ${({ $blend }) => ($blend ? "none" : "var(--shadow)")};

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    justify-items: stretch;
  }

  @media (max-width: 680px) {
    gap: 0.55rem;
  }
`;

export const AccountHeading = styled.h2`
  margin: 0;
  font-size: 0.7rem;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

export const AccountTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
`;

export const AccountIdentityBlock = styled.div`
  ${gridStackCss("0.12rem")};
  min-width: 0;
`;

export const AccountName = styled.strong`
  display: block;
  min-width: 0;
  font-size: 1rem;
  line-height: 1.05;
`;

export const AccountSubline = styled(MetaText)`
  font-size: 0.76rem;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 28ch;

  @media (max-width: 680px) {
    white-space: normal;
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    line-height: 1.35;
  }
`;

export const AccountActions = styled(WrapRow)`
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 0.45rem;

  @media (max-width: 680px) {
    justify-content: flex-start;
    flex-wrap: wrap;
    width: 100%;
  }
`;

export const AccountThemeWrap = styled.div`
  position: relative;
  display: inline-flex;
`;

export const AccountIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;

  &:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.94);
  }

  svg {
    width: 1rem;
    height: 1rem;
  }
`;

export const AccountThemePopover = styled.div`
  position: absolute;
  top: calc(100% + 0.45rem);
  right: 0;
  z-index: 30;
  width: min(280px, 70vw);
  ${gridStackCss("0.42rem")};
  padding: 0.55rem;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel-strong) 92%, white 8%);
  box-shadow: 0 20px 50px rgba(27, 21, 16, 0.16);
`;

export const AccountThemePopoverHeader = styled.div`
  ${gridStackCss("0.14rem")};
`;

export const AccountThemePopoverTitle = styled.strong`
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

export const AccountThemeList = styled.div`
  ${gridStackCss("0.22rem")};
`;

export const AccountThemeOption = styled.button<{ $active: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 46%, rgba(31, 41, 55, 0.12))" : "var(--line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 10%, white 90%)" : "rgba(255, 255, 255, 0.6)")};
  color: var(--ink);
  border-radius: 14px;
  padding: 0.48rem 0.56rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  text-align: left;
  cursor: pointer;
`;

export const AccountThemePreview = styled.div`
  ${flexWrapRowCss("0.24rem")};
  align-items: center;
`;

export const AccountThemeSwatch = styled.span<{ $color: string }>`
  width: 0.72rem;
  height: 0.72rem;
  border-radius: 999px;
  background: ${({ $color }) => $color};
  border: 1px solid rgba(31, 41, 55, 0.12);
`;

export const AccountThemeLabel = styled.span`
  font-size: 0.84rem;
  font-weight: 700;
`;

export const AccountThemeModeToggle = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem;
  padding: 0.18rem;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.62);
`;

export const AccountThemeModeButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 10px;
  padding: 0.4rem 0.56rem;
  background: ${({ $active }) => ($active ? "rgba(31, 41, 55, 0.08)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--ink)" : "var(--muted)")};
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

export const AccountButton = styled.button`
  ${primaryButtonCss};
  padding: 0.5rem 0.82rem;
  background: var(--ink);

  @media (max-width: 680px) {
    min-height: 2.65rem;
  }
`;

export const AccountMetaGroup = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
  min-width: 0;

  @media (max-width: 680px) {
    justify-content: flex-start;
  }
`;

export const AccountBadge = styled.span<{ $tone?: "default" | "accent" }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.24rem 0.58rem;
  border: 1px solid
    ${({ $tone }) => ($tone === "accent" ? "color-mix(in srgb, var(--accent) 42%, rgba(31, 41, 55, 0.1))" : "var(--line)")};
  background: ${({ $tone }) => ($tone === "accent" ? "color-mix(in srgb, var(--accent) 12%, white 88%)" : "rgba(255, 255, 255, 0.58)")};
  color: ${({ $tone }) => ($tone === "accent" ? "var(--accent-deep)" : "var(--muted)")};
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1;
`;

export const AdminPanelCard = styled(CardSection)`
  align-self: stretch;
  align-content: start;
  min-height: 0;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  padding: 0.95rem 1rem;
  gap: 0.45rem;
`;

export const AdminPanelTitle = styled.h2`
  margin: 0;
`;

export const AdminPanelForm = styled.form`
  ${gridStackCss("0.45rem")};
`;

export const AdminPanelRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
`;

export const AdminPanelInput = styled.input`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.7rem 0.8rem;
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  min-width: 0;
`;

export const AdminPanelNoteInput = styled.textarea`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.7rem 0.8rem;
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  min-width: 0;
  resize: vertical;
  font: inherit;
`;

export const AdminPanelSubmitButton = styled.button`
  ${primaryButtonCss};
  padding: 0.72rem 0.95rem;
  background: var(--ink);
`;

export const AdminPanelSecondaryButton = styled.button`
  ${secondaryButtonCss};
  padding: 0.62rem 0.9rem;
  line-height: 1;
`;

export const AdminPanelMessage = styled(MetaText)`
  color: var(--sidebar-ink);
`;

export const AdminPanelToolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.45rem;
  align-items: center;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

export const AdminPanelTableWrap = styled.div`
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.58);
`;

export const AdminPanelTable = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

export const AdminPanelHeaderCell = styled.th`
  ${tableHeaderCellCss};
  padding: 0.58rem 0.8rem;
  font-size: 0.73rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.45);
`;

export const AdminPanelCell = styled.td`
  ${tableBodyCellCss};
  padding: 0.56rem 0.8rem;
  vertical-align: top;
`;

export const AdminPanelActionCell = styled(AdminPanelCell)`
  white-space: nowrap;
  width: 1%;

  > button + button {
    margin-left: 0.35rem;
  }
`;

export const AdminPanelUserButton = styled.button<{ $active: boolean }>`
  width: 100%;
  border: 1px solid ${({ $active }) => ($active ? "var(--accent)" : "transparent")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 10%, white 90%)" : "transparent")};
  border-radius: 12px;
  padding: 0.34rem 0.46rem;
  text-align: left;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease;

  &:hover {
    background: rgba(255, 255, 255, 0.6);
  }
`;

export const AdminPanelInlineMeta = styled(MetaText)`
  font-size: 0.74rem;
  line-height: 1.2;
`;

export const AdminPanelBadgeRow = styled.div`
  ${flexWrapRowCss("0.35rem")};
  align-items: center;
`;

export const AdminPanelBadge = styled.span<{ $tone?: "default" | "accent" | "muted" }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.16rem 0.48rem;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "accent"
        ? "color-mix(in srgb, var(--accent) 42%, rgba(31, 41, 55, 0.1))"
        : "var(--line)"};
  background: ${({ $tone }) =>
    $tone === "accent"
      ? "color-mix(in srgb, var(--accent) 12%, white 88%)"
      : $tone === "muted"
        ? "rgba(31, 41, 55, 0.06)"
        : "rgba(255, 255, 255, 0.66)"};
  color: ${({ $tone }) => ($tone === "accent" ? "var(--accent-deep)" : "var(--muted)")};
`;

export const AdminPanelPager = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

export const AdminPanelModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(12, 18, 24, 0.45);
  display: grid;
  place-items: center;
  padding: 1rem;
  z-index: 40;
`;

export const AdminPanelModalCard = styled.section`
  ${sectionPanelCss("1rem", "0.7rem")};
  width: min(420px, 100%);
  border-radius: var(--radius-xl);
  box-shadow: 0 28px 80px rgba(10, 10, 10, 0.24);
`;

export const AdminPanelModalActions = styled.div`
  ${flexWrapRowCss("0.5rem")};
  justify-content: flex-end;
`;

export const WorkspaceModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(12, 18, 24, 0.5);
  backdrop-filter: blur(10px);

  @media (max-width: 760px) {
    padding: 0.55rem;
  }
`;

export const WorkspaceModalCard = styled.section`
  ${sectionPanelCss("1rem", "0.7rem")};
  width: min(1120px, 100%);
  max-height: min(88vh, 920px);
  overflow: hidden;
  border-radius: var(--radius-xl);
  box-shadow: 0 28px 80px rgba(10, 10, 10, 0.24);

  @media (max-width: 760px) {
    width: 100%;
    max-height: calc(100dvh - 1.1rem);
    padding: 0.82rem;
  }
`;

export const WorkspaceModalHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    gap: 0.6rem;
  }
`;

export const WorkspaceModalTitleBlock = styled.div`
  ${gridStackCss("0.25rem")};
`;

export const WorkspaceModalTitle = styled.h2`
  margin: 0;
  font-size: 1.2rem;
`;

export const WorkspaceModalMeta = styled(MetaText)`
  margin: 0;
`;

export const WorkspaceModalCloseButton = styled.button`
  ${secondaryButtonCss};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: start;

  @media (max-width: 760px) {
    width: 100%;
  }
`;

export const PlatformPage = styled.main`
  width: 100%;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  overflow: hidden;
  padding: 0;

  @media (max-width: 1100px) {
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 0.75rem;
  }

  @media (max-width: 640px) {
    padding: 0.55rem;
  }
`;

export const PlatformLayout = styled.div<{ $collapsed: boolean }>`
  width: 100%;
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "94px" : "338px")} minmax(0, 1fr);
  gap: 0;
  align-items: start;
  transition: grid-template-columns 240ms ease;

  @media (max-width: 1100px) {
    height: auto;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
`;

export const PlatformSidebar = styled.aside`
  position: sticky;
  top: 0;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
  padding: 0.56rem 0.58rem;
  border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 16%),
    var(--sidebar-bg);
  color: var(--sidebar-ink);
  box-shadow: 0 22px 60px rgba(10, 10, 10, 0.16);
  border: 1px solid var(--sidebar-line);
  transition: background 240ms ease, padding 220ms ease, box-shadow 240ms ease;

  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  @media (max-width: 1100px) {
    position: static;
    height: auto;
    max-height: none;
    overflow: visible;
    border-radius: var(--radius-xl);
  }
`;

export const PlatformMain = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  overflow: auto;
  ${gridStackCss("0.7rem")};
  align-content: stretch;
  padding: 0.48rem 0.64rem;
  animation: fadeSlideIn 260ms ease;

  &::-webkit-scrollbar {
    width: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(31, 41, 55, 0.14);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  @media (max-width: 1100px) {
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 0;
  }
`;

export const PlatformUtilityBar = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
`;

export const PlatformUtilityCard = styled.div`
  width: min(560px, 100%);

  > section {
    box-shadow: 0 16px 34px rgba(32, 26, 20, 0.1);
  }
`;

export const PlatformSidebarHeader = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "minmax(0, 1fr) auto")};
  gap: 0.34rem;
  align-items: start;
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
  padding: 0.06rem 0.08rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

export const PlatformBrandBlock = styled.div<{ $collapsed: boolean }>`
  min-width: 0;
  ${gridStackCss("0.08rem")};
  display: ${({ $collapsed }) => ($collapsed ? "none" : "grid")};
`;

export const PlatformEyebrow = styled.div`
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sidebar-muted);
  font-size: 0.66rem;
`;

export const PlatformTitle = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: 1.5rem;
  line-height: 0.98;
  color: var(--sidebar-ink);
`;

export const PlatformSubhead = styled.p`
  margin: 0;
  color: var(--sidebar-muted);
  font-size: 0.72rem;
  line-height: 1.18;
`;

export const PlatformCollapseButton = styled.button`
  border: 1px solid var(--sidebar-line);
  background: var(--sidebar-card);
  color: var(--sidebar-ink);
  border-radius: 999px;
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;

  &:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.08);
  }
`;

export const PlatformSidebarSection = styled(SidebarSurfaceSection)``;

export const PlatformSidebarPrimary = styled.div`
  ${gridStackCss("0.36rem")};
  align-content: start;
`;

export const PlatformSidebarFooter = styled.div`
  margin-top: auto;
  ${gridStackCss("0.36rem")};
`;

export const PlatformSidebarSectionIcon = styled.div<{ $collapsed?: boolean }>`
  width: ${({ $collapsed }) => ($collapsed ? "1.6rem" : "0")};
  height: ${({ $collapsed }) => ($collapsed ? "1.6rem" : "0")};
  border-radius: 999px;
  border: 1px solid var(--sidebar-line);
  background: rgba(255, 255, 255, 0.06);
  color: var(--sidebar-ink);
  display: grid;
  place-items: center;
  font-size: 0.76rem;
  font-weight: 800;
  opacity: ${({ $collapsed }) => ($collapsed ? 1 : 0)};
  margin-inline: auto;
  overflow: hidden;
  transition:
    opacity 180ms ease,
    width 180ms ease,
    height 180ms ease;

  svg {
    width: 0.9rem;
    height: 0.9rem;
  }
`;

export const PlatformSectionTitle = styled.div<{ $collapsed?: boolean }>`
  font-size: 0.69rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--sidebar-ink);
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
  opacity: 0.86;
`;

export const PlatformNavGrid = styled.div`
  ${gridStackCss("0.18rem")};
`;

export const PlatformNavButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid
    ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 46%, white 8%)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--sidebar-ink)" : "var(--sidebar-muted)")};
  border-radius: 16px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.5rem 0.42rem" : "0.54rem 0.62rem")};
  text-align: left;
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "1.15rem minmax(0, 1fr)")};
  align-items: start;
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
  column-gap: ${({ $collapsed }) => ($collapsed ? "0" : "0.72rem")};
  row-gap: 0;
  cursor: pointer;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    padding 180ms ease;

  &:hover {
    transform: ${({ $collapsed }) => ($collapsed ? "translateY(-1px)" : "translateX(2px)")};
  }

  > div {
    min-width: 0;
  }
`;

export const PlatformNavLabel = styled.strong<{ $collapsed: boolean }>`
  font-size: 0.87rem;
  line-height: 1.15;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

export const PlatformNavMeta = styled(MetaText)<{ $collapsed: boolean }>`
  margin-top: 0.22rem;
  color: var(--sidebar-muted);
  font-size: 0.71rem;
  line-height: 1.16;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

export const PlatformNavGlyph = styled.span<{ $active: boolean }>`
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $active }) => ($active ? "var(--accent-warm)" : "rgba(255,255,255,0.72)")};
  transition: color 180ms ease, transform 180ms ease;

  svg {
    width: 1rem;
    height: 1rem;
  }
`;

export const PlatformSessionWrap = styled.div<{ $collapsed?: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};

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

export const PlatformThemeList = styled.div`
  ${gridStackCss("0.16rem")};
`;

export const PlatformThemePickerRow = styled.div`
  position: relative;
  display: grid;
  gap: 0.35rem;
`;

export const PlatformDropdownTrigger = styled.button<{ $collapsed: boolean }>`
  border: 1px solid var(--sidebar-line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--sidebar-ink);
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.38rem" : "0.46rem 0.58rem")};
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "auto minmax(0, 1fr)")};
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;

  &:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.065);
  }
`;

export const PlatformSwatchPreview = styled.div`
  ${flexWrapRowCss("0.28rem")};
  align-items: center;
`;

export const PlatformThemeValue = styled.span<{ $collapsed: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
  text-align: left;
  font-size: 0.84rem;
  font-weight: 700;
`;

export const PlatformDropdownMenu = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 0.35rem);
  z-index: 20;
  ${gridStackCss("0.14rem")};
  padding: 0.24rem;
  border-radius: 16px;
  border: 1px solid var(--sidebar-line);
  background: color-mix(in srgb, var(--sidebar-bg) 92%, black 8%);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.26);
`;

export const PlatformDropdownMenuItem = styled.button<{ $active: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "var(--accent)" : "transparent")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent")};
  color: var(--sidebar-ink);
  border-radius: 12px;
  padding: 0.44rem 0.5rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`;

export const PlatformThemeModeToggle = styled.div<{ $collapsed: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "grid" : "grid")};
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "1fr 1fr")};
  gap: 0.18rem;
  padding: 0.16rem;
  border-radius: 14px;
  border: 1px solid var(--sidebar-line);
  background: rgba(255, 255, 255, 0.03);
`;

export const PlatformThemeModeButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 10px;
  padding: 0.36rem 0.5rem;
  background: ${({ $active }) => ($active ? "rgba(255, 255, 255, 0.12)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--sidebar-ink)" : "var(--sidebar-muted)")};
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
`;

export const PlatformThemeButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "var(--accent)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: var(--sidebar-ink);
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.38rem" : "0.44rem 0.58rem")};
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "auto minmax(0, 1fr)")};
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "0.6rem")};
  align-items: center;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;

  &:hover {
    transform: ${({ $collapsed }) => ($collapsed ? "translateY(-1px)" : "translateX(2px)")};
  }
`;

export const PlatformSwatchRow = styled.div<{ $collapsed?: boolean }>`
  ${flexWrapRowCss("0.35rem")};
  justify-content: ${({ $collapsed }) => ($collapsed ? "center" : "flex-start")};
`;

export const PlatformSwatch = styled.span<{ $color: string }>`
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 999px;
  background: ${({ $color }) => $color};
  border: 1px solid rgba(255, 255, 255, 0.18);
`;

export const PlatformThemeLabel = styled.span<{ $collapsed: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
  font-size: 0.84rem;
`;

export const PlatformSidebarMeta = styled(MetaText)<{ $collapsed?: boolean }>`
  font-size: 0.74rem;
  line-height: 1.18;
  ${sidebarFadingMetaCss("120px")};
`;

export const ChartCardShell = styled.article`
  ${strongSurfaceCss};
  background: linear-gradient(180deg, rgba(255, 253, 249, 0.98), rgba(248, 241, 234, 0.96));
  padding: 1.2rem;
  min-height: 280px;
`;

export const ChartCardHeading = styled.h3`
  ${displayHeadingCss};
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
`;

export const ChartCardPreview = styled.div`
  min-height: 200px;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(201, 111, 59, 0.08);
  display: grid;
  place-items: center;
  color: var(--muted);
  padding: 1rem;
  text-align: center;
`;

export const ChartCardPreviewImage = styled.img`
  display: block;
  max-width: 100%;
  border-radius: calc(var(--radius-md) - 4px);
`;

function resolveTabletChatPaneMinHeight(minHeight?: number): string {
  const clampedHeight = Math.min(minHeight ?? 430, 620);
  return `min(${clampedHeight}px, 72dvh)`;
}

function resolvePhoneChatPaneMinHeight(minHeight?: number): string {
  const clampedHeight = Math.min(minHeight ?? 430, 520);
  return `min(${clampedHeight}px, 68dvh)`;
}

export const ChartCardCode = styled.pre`
  margin: 1rem 0 0;
  padding: 0.9rem;
  border-radius: var(--radius-md);
  background: #221f1b;
  color: #f8f6f2;
  overflow: auto;
  font-size: 0.85rem;
`;

export const ChatKitPaneCard = styled.section`
  position: sticky;
  top: 0.8rem;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.96), rgba(26, 36, 47, 0.98));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 0.72rem;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;

  @media (max-width: 1180px) {
    position: static;
    top: auto;
    height: auto;
  }

  @media (max-width: 760px) {
    padding: 0.62rem;
    border-radius: calc(var(--radius-xl) - 2px);
  }
`;

export const ChatKitPaneMeta = styled(OverlayMetaText)``;

export const ChatKitPaneHarness = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
`;

export const ChatKitPaneStatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  min-height: 2rem;

  @media (max-width: 760px) {
    align-items: flex-start;
  }
`;

export const ChatKitPaneStatusActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  width: 100%;
  flex: 1 1 auto;
  flex-wrap: nowrap;

  @media (max-width: 760px) {
    flex-wrap: wrap;
  }
`;

export const ChatKitPaneStatusText = styled(OverlayMetaText)<{ $light?: boolean }>`
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  margin-left: auto;
  text-align: right;
  color: ${({ $light }) => ($light ? "var(--muted)" : "rgba(248, 246, 242, 0.72)")};
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 760px) {
    order: 3;
    flex-basis: 100%;
    text-align: left;
    white-space: normal;
  }
`;

export const ChatKitPaneIconButton = styled.button<{ $light?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid ${({ $light }) => ($light ? "rgba(31, 41, 55, 0.14)" : "rgba(255, 255, 255, 0.18)")};
  background: ${({ $light }) => ($light ? "rgba(255, 255, 255, 0.92)" : "rgba(255, 255, 255, 0.08)")};
  color: ${({ $light }) => ($light ? "#1f2937" : "#f8f6f2")};
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    background: ${({ $light }) => ($light ? "rgba(255, 255, 255, 0.98)" : "rgba(255, 255, 255, 0.12)")};
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }

  svg {
    width: 0.95rem;
    height: 0.95rem;
  }
`;

export const ChatKitPanePill = styled.div`
  display: inline-flex;
  width: fit-content;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const ChatKitPaneSurface = styled.div<{ $light?: boolean; $minHeight?: number }>`
  min-width: 0;
  width: 100%;
  max-width: 100%;
  flex: 1 1 ${({ $minHeight }) => ($minHeight ? `${$minHeight}px` : "430px")};
  min-height: 0;
  border-radius: var(--radius-lg);
  overflow: auto;
  overscroll-behavior: contain;
  background: ${({ $light }) => ($light ? "rgba(255, 255, 255, 0.82)" : "rgba(255, 255, 255, 0.08)")};
  border: 1px solid ${({ $light }) => ($light ? "rgba(31, 41, 55, 0.1)" : "rgba(255, 255, 255, 0.12)")};

  openai-chatkit {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  @media (max-width: 1180px) {
    min-height: ${({ $minHeight }) => resolveTabletChatPaneMinHeight($minHeight)};
  }

  @media (max-width: 760px) {
    flex-basis: auto;
    min-height: ${({ $minHeight }) => resolvePhoneChatPaneMinHeight($minHeight)};
  }
`;

export const ChatKitPaneEmpty = styled.div`
  ${emptyStateCss};
  min-height: inherit;
  color: rgba(248, 246, 242, 0.74);
  padding: 1rem;
`;

export const ChatKitPaneToolbar = styled(WrapRow)`
  gap: 0.35rem;
  flex: 0 0 auto;
  flex-wrap: nowrap;

  @media (max-width: 760px) {
    flex-wrap: wrap;
    width: 100%;
  }
`;

export const ChatKitPaneToolbarButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.92);
  color: #1f2937;
  border-radius: 999px;
  padding: 0.48rem 0.78rem;
  font: inherit;
  font-weight: 700;
  font-size: 0.84rem;
  line-height: 1;
  cursor: pointer;

  @media (max-width: 760px) {
    flex: 1 1 0;
    min-height: 2.6rem;
  }
`;

export const ChatKitPaneModeRow = styled.div<{ $light?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.14rem;
  flex: 0 0 auto;
  padding: 0.12rem;
  border-radius: 999px;
  border: 1px solid ${({ $light }) => ($light ? "rgba(31, 41, 55, 0.12)" : "rgba(255, 255, 255, 0.12)")};
  background: ${({ $light }) => ($light ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.07)")};
`;

export const ChatKitPaneModeButton = styled.button<{ $active?: boolean; $light?: boolean }>`
  border: 1px solid
    ${({ $active, $light }) =>
      $active
        ? $light
          ? "rgba(31, 41, 55, 0.18)"
          : "rgba(244, 196, 48, 0.62)"
        : $light
          ? "rgba(31, 41, 55, 0.14)"
          : "rgba(255, 255, 255, 0.2)"};
  background: ${({ $active, $light }) =>
    $active
      ? $light
        ? "rgba(31, 41, 55, 0.08)"
        : "rgba(244, 196, 48, 0.18)"
      : $light
        ? "rgba(255, 255, 255, 0.78)"
        : "rgba(255, 255, 255, 0.08)"};
  color: ${({ $light }) => ($light ? "#1f2937" : "#f8f6f2")};
  border-radius: 999px;
  padding: 0.28rem 0.56rem;
  font: inherit;
  font-weight: 700;
  font-size: 0.76rem;
  line-height: 1;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

export const ChatKitPaneHarnessMeta = styled(OverlayMetaText)<{ $light?: boolean }>`
  margin: 0;
  color: ${({ $light }) => ($light ? "var(--muted)" : "rgba(248, 246, 242, 0.74)")};
  font-size: 0.8rem;
  line-height: 1.35;
`;

export const DatasetInventoryPanel = styled(CardSection)``;

export const DatasetInventoryHeader = styled.div`
  ${gridStackCss("0.35rem")};
`;

export const DatasetInventoryToolbar = styled(WrapRow)`
  align-items: center;
`;

export const DatasetInventoryUploadInput = styled.input`
  max-width: 100%;
`;

export const DatasetInventoryButton = styled(SecondaryActionButton)``;

export const DatasetInventoryList = styled.div`
  ${gridStackCss("0.8rem")};
`;

export const DatasetInventoryCard = styled.article`
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.72);
  overflow: hidden;
`;

export const DatasetInventoryToggle = styled.button`
  width: 100%;
  border: 0;
  background: transparent;
  padding: 1rem;
  text-align: left;
  ${gridStackCss("0.35rem")};
  cursor: pointer;
`;

export const DatasetInventoryMetaRow = styled.div`
  ${flexWrapRowCss("0.6rem")};
`;

export const DatasetInventoryExpanded = styled.div`
  border-top: 1px solid rgba(31, 41, 55, 0.08);
  padding: 1rem;
  ${gridStackCss("0.8rem")};
`;

export const DatasetInventoryScroller = styled(TableScroller)``;

export const DatasetInventoryTable = styled(PlainTable)`
  width: max-content;
  min-width: 100%;
`;

export const DatasetInventoryTh = styled.th`
  ${tableHeaderCellCss};
  padding: 0.7rem 0.75rem;
  background: rgba(31, 41, 55, 0.04);
  font-size: 0.9rem;
  max-width: 400px;
`;

export const DatasetInventoryTd = styled.td`
  ${tableBodyCellCss};
  padding: 0.7rem 0.75rem;
  vertical-align: top;
  max-width: 400px;
`;

export const DatasetInventoryCell = styled.div`
  max-width: 400px;
  overflow-wrap: anywhere;
  white-space: normal;
`;

export const DatasetInventoryPager = styled.div`
  ${flexWrapRowCss("0.6rem")};
  align-items: center;
`;

export const DatasetInventoryPageButton = styled(SecondaryActionButton)`
  padding: 0.7rem 1rem;
`;

export const SmokeTestPanel = styled(CardSection)``;

export const SmokeTestToolbar = styled(WrapRow)``;

export const SmokeTestButton = styled.button`
  ${primaryButtonCss};
  background: linear-gradient(135deg, var(--accent-deep), #9f4d21);
  color: #fffaf4;
`;

export const SmokeTestResultList = styled.div`
  ${gridStackCss("0.75rem")};
`;

export const SmokeTestResultCard = styled.div<{ $ok: boolean }>`
  border-radius: var(--radius-md);
  padding: 0.85rem 0.95rem;
  border: 1px solid ${({ $ok }) => ($ok ? "rgba(34, 197, 94, 0.28)" : "rgba(220, 38, 38, 0.28)")};
  background: ${({ $ok }) => ($ok ? "rgba(34, 197, 94, 0.08)" : "rgba(220, 38, 38, 0.08)")};
`;

export const SmokeTestAggregateTable = styled(PlainTable)`
  width: 100%;
`;

export const SmokeTestTh = styled.th`
  ${tableHeaderCellCss};
  padding: 0.6rem 0.7rem;
`;

export const SmokeTestTd = styled.td`
  ${tableBodyCellCss};
  padding: 0.6rem 0.7rem;
`;

export const SmokeTestChartGrid = styled.div`
  ${gridStackCss("1rem")};
`;

export const SmokeTestExpectations = styled.ul`
  margin: 0;
  padding-left: 1.2rem;
  ${gridStackCss("0.45rem")};
`;

export const NarrativeCardShell = styled.article`
  ${strongSurfaceCss};
  padding: 1.2rem;
`;

export const NarrativeCardHeading = styled.h3`
  ${displayHeadingCss};
  margin: 0 0 1rem;
  font-size: 1.35rem;
`;

export const NarrativeCardBody = styled.div`
  color: var(--muted);
  line-height: 1.7;

  h2,
  h3 {
    color: var(--ink);
    font-family: var(--font-display);
  }
`;

export const DatasetChartWrapper = styled.div<{ $background: string; $border: string }>`
  min-height: 300px;
  padding: 1rem;
  border-radius: var(--radius-md);
  background: ${(props) => props.$background};
  border: 1px solid ${(props) => props.$border};
`;

export const DatasetChartEmpty = styled.div`
  min-height: 240px;
  display: grid;
  place-items: center;
  color: var(--muted);
  text-align: center;
`;

export const ToolLogCard = styled.aside`
  ${warmSurfaceCss};
  padding: 1rem 1.2rem;
`;

export const ToolLogHeading = styled.h3`
  ${displayHeadingCss};
  margin: 0 0 0.8rem;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

export const ToolLogList = styled.ul`
  ${stackedListCss};
  padding-left: 1.1rem;
  color: var(--muted);
  gap: 0.7rem;
`;

export const ToolLogName = styled.strong`
  color: var(--ink);
`;
