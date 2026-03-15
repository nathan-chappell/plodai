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

export const AccountCard = styled(CardSection)`
  gap: 0.4rem;
`;

export const AccountHeading = styled.h2`
  margin: 0;
`;

export const AccountActions = styled(WrapRow)`
  align-items: center;
`;

export const AccountButton = styled.button`
  ${primaryButtonCss};
  padding: 0.8rem 1rem;
  background: var(--ink);
`;

export const PlatformPage = styled.main`
  width: 100%;
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
  padding: 0;

  @media (max-width: 1100px) {
    height: auto;
    max-height: none;
    overflow: visible;
    padding: 0.75rem;
  }
`;

export const PlatformLayout = styled.div<{ $collapsed: boolean }>`
  width: 100%;
  height: 100vh;
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
  max-height: 100vh;
  overflow-y: auto;
  padding: 0.62rem 0.64rem;
  border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 18%),
    var(--sidebar-bg);
  color: var(--sidebar-ink);
  ${gridStackCss("0.42rem")};
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
  height: 100vh;
  max-height: 100vh;
  overflow: auto;
  ${gridStackCss("1rem")};
  padding: 0.58rem 0.72rem;
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

export const PlatformSidebarHeader = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: ${({ $collapsed }) => ($collapsed ? "1fr" : "minmax(0, 1fr) auto")};
  gap: 0.4rem;
  align-items: start;
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
`;

export const PlatformBrandBlock = styled.div<{ $collapsed: boolean }>`
  min-width: 0;
  ${gridStackCss("0.12rem")};
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
  font-size: 1.7rem;
  line-height: 1;
  color: var(--sidebar-ink);
`;

export const PlatformSubhead = styled.p`
  margin: 0;
  color: var(--sidebar-muted);
  font-size: 0.78rem;
  line-height: 1.22;
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
`;

export const PlatformSectionTitle = styled.div<{ $collapsed?: boolean }>`
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--sidebar-ink);
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
  opacity: 0.86;
`;

export const PlatformNavGrid = styled.div`
  ${gridStackCss("0.24rem")};
`;

export const PlatformNavButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid
    ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 46%, white 8%)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--sidebar-ink)" : "var(--sidebar-muted)")};
  border-radius: 16px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.54rem 0.46rem" : "0.56rem 0.66rem")};
  text-align: left;
  display: grid;
  justify-items: ${({ $collapsed }) => ($collapsed ? "center" : "start")};
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "0.08rem")};
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
`;

export const PlatformNavLabel = styled.strong<{ $collapsed: boolean }>`
  font-size: 0.94rem;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

export const PlatformNavMeta = styled(MetaText)<{ $collapsed: boolean }>`
  color: var(--sidebar-muted);
  font-size: 0.76rem;
  line-height: 1.2;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

export const PlatformNavGlyph = styled.span<{ $active: boolean }>`
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 999px;
  background: ${({ $active }) => ($active ? "var(--accent)" : "rgba(255,255,255,0.18)")};
  transition: background 180ms ease, transform 180ms ease;
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
  ${gridStackCss("0.22rem")};
`;

export const PlatformThemeButton = styled.button<{ $active: boolean; $collapsed: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "var(--accent)" : "var(--sidebar-line)")};
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent")};
  color: var(--sidebar-ink);
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "0.38rem" : "0.42rem 0.6rem")};
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
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.96), rgba(26, 36, 47, 0.98));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 0.82rem;
  box-shadow: var(--shadow);
  ${gridStackCss("0.45rem")};
`;

export const ChatKitPaneMeta = styled(OverlayMetaText)``;

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

export const ChatKitPaneSurface = styled.div<{ $light?: boolean }>`
  min-width: 0;
  width: 100%;
  max-width: 100%;
  min-height: 430px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: ${({ $light }) => ($light ? "rgba(255, 255, 255, 0.82)" : "rgba(255, 255, 255, 0.08)")};
  border: 1px solid ${({ $light }) => ($light ? "rgba(31, 41, 55, 0.1)" : "rgba(255, 255, 255, 0.12)")};

  openai-chatkit {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
`;

export const ChatKitPaneEmpty = styled.div`
  ${emptyStateCss};
  min-height: 430px;
  color: rgba(248, 246, 242, 0.74);
  padding: 1rem;
`;

export const ChatKitPaneToolbar = styled(WrapRow)``;

export const ChatKitPaneToolbarButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.92);
  color: #1f2937;
  border-radius: 999px;
  padding: 0.65rem 0.95rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
`;

export const ChatKitPaneHarnessMeta = styled(OverlayMetaText)<{ $light?: boolean }>`
  margin: 0;
  color: ${({ $light }) => ($light ? "var(--muted)" : "rgba(248, 246, 242, 0.74)")};
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
