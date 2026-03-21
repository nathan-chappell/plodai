import styled from "styled-components";

import {
  MetaText,
  displayHeadingCss,
  flexWrapRowCss,
  gridStackCss,
  panelSurfaceCss,
  sectionPanelCss,
} from "../app/styles";

const AgentSurface = styled.section`
  ${sectionPanelCss("0.9rem", "0.58rem")};
  border-radius: var(--radius-xl);
`;

export const AgentPage = styled.section`
  min-width: 0;
  min-height: 100%;
  height: 100%;
  display: grid;
  gap: 0.7rem;
  align-content: stretch;

  @media (min-width: 1181px) {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  @media (max-width: 740px) {
    gap: 0.6rem;
  }
`;

export const AgentHeroRow = styled.section`
  ${sectionPanelCss("0.62rem 0.82rem", "0.35rem")};
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.7rem;
  align-items: start;
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 250, 244, 0.88)),
    var(--panel);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }

  @media (max-width: 740px) {
    padding: 0.72rem 0.76rem;
    gap: 0.5rem;
  }
`;

export const AgentHeader = styled.section`
  ${gridStackCss("0.12rem")};
  min-width: 0;
`;

export const AgentEyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.58rem;
`;

export const AgentTitle = styled.h2`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(1.05rem, 1.9vw, 1.56rem);
  line-height: 0.98;
`;

export const AgentSubhead = styled.p`
  margin: 0;
  color: var(--muted);
  max-width: 64ch;
  font-size: 0.72rem;
  line-height: 1.18;

  @media (max-width: 740px) {
    font-size: 0.78rem;
    line-height: 1.35;
  }
`;

export const AgentTabBar = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.08rem;
  justify-content: flex-start;
  width: fit-content;
  padding: 0.12rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 8px 20px rgba(32, 26, 20, 0.05);
`;

export const AgentTabButton = styled.button<{ $active: boolean }>`
  border: 0;
  background: ${({ $active }) => ($active ? "var(--panel)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--ink)" : "var(--muted)")};
  border-radius: 999px;
  padding: 0.3rem 0.62rem;
  font-weight: 700;
  font-size: 0.73rem;
  cursor: pointer;
  box-shadow: ${({ $active }) => ($active ? "0 4px 14px rgba(32, 26, 20, 0.07)" : "none")};
  transition: background 180ms ease, color 180ms ease, box-shadow 180ms ease, transform 180ms ease;

  &:hover {
    transform: translateY(-1px);
  }
`;

export const ReportWorkspaceLayout = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 0.8rem;
  align-items: stretch;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
    align-items: start;
  }

  @media (max-width: 740px) {
    gap: 0.65rem;
  }
`;

export const ReportWorkspaceColumn = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  ${gridStackCss("0.6rem")};

  @media (min-width: 1181px) {
    overflow: auto;
    padding-right: 0.12rem;
  }
`;

export const ReportChatColumn = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-self: stretch;
`;

export const AgentPanel = styled(AgentSurface)``;

export const AgentSectionHeader = styled.div`
  ${gridStackCss("0.25rem")};
`;

export const AgentSectionTitle = styled.h3`
  margin: 0;
  font-size: 1.05rem;
`;

export const AgentInlineToolbar = styled.div`
  ${flexWrapRowCss("0.5rem")};
  align-items: center;
  justify-content: space-between;
`;

export const AgentInlineLabel = styled.span`
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const AgentSegmentedControl = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.08rem;
  padding: 0.14rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.5);
`;

export const AgentSegmentButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0.34rem 0.68rem;
  background: ${({ $active }) => ($active ? "var(--ink)" : "transparent")};
  color: ${({ $active }) => ($active ? "#fffaf4" : "var(--muted)")};
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease, transform 180ms ease;

  &:hover {
    transform: translateY(-1px);
  }
`;

export const AgentNoteList = styled.ul`
  margin: 0;
  padding-left: 1rem;
  ${gridStackCss("0.38rem")};
  color: var(--ink);
`;

export const AgentTextarea = styled.textarea`
  min-height: 260px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.95rem 1rem;
  background: rgba(255, 255, 255, 0.75);
  resize: vertical;
  font: inherit;
`;

export const AgentHighlight = styled.div`
  padding: 0.95rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(201, 111, 59, 0.08);
  border: 1px solid rgba(201, 111, 59, 0.18);
`;

export const ReportEffectsPanel = styled.div`
  ${gridStackCss("0.6rem")};
`;

export const ReportEffectCard = styled(AgentSurface)`
  padding: 0.82rem;
  gap: 0.55rem;
  min-width: 0;
`;

export const AgentMetaText = styled(MetaText)``;
