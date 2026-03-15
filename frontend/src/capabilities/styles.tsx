import styled from "styled-components";

import {
  MetaText,
  displayHeadingCss,
  flexWrapRowCss,
  gridStackCss,
  panelSurfaceCss,
  sectionPanelCss,
} from "../app/styles";

const CapabilitySurface = styled.section`
  ${sectionPanelCss("1.4rem", "0.95rem")};
  border-radius: var(--radius-xl);
`;

export const CapabilityHeader = styled.section`
  ${sectionPanelCss("1.5rem", "0.9rem")};
  border-radius: var(--radius-xl);
`;

export const CapabilityEyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

export const CapabilityTitle = styled.h2`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 3rem);
`;

export const CapabilitySubhead = styled.p`
  margin: 0;
  color: var(--muted);
  max-width: 72ch;
  line-height: 1.75;
`;

export const CapabilityTabBar = styled.div`
  ${flexWrapRowCss("0.55rem")};
`;

export const CapabilityTabButton = styled.button<{ $active: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.38)" : "var(--line)")};
  background: ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.14)" : "rgba(255, 255, 255, 0.55)")};
  color: var(--ink);
  border-radius: 999px;
  padding: 0.65rem 0.95rem;
  font-weight: 700;
  cursor: pointer;
`;

export const ReportWorkspaceLayout = styled.section`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 430px;
  gap: 1.5rem;
  align-items: start;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

export const ReportWorkspaceColumn = styled.div`
  min-width: 0;
  ${gridStackCss("1rem")};
`;

export const ReportChatColumn = styled.div`
  min-width: 0;
`;

export const CapabilityPanel = styled(CapabilitySurface)``;

export const CapabilitySectionHeader = styled.div`
  ${gridStackCss("0.4rem")};
`;

export const CapabilitySectionTitle = styled.h3`
  margin: 0;
  font-size: 1.2rem;
`;

export const CapabilityTextarea = styled.textarea`
  min-height: 260px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.95rem 1rem;
  background: rgba(255, 255, 255, 0.75);
  resize: vertical;
  font: inherit;
`;

export const CapabilityHighlight = styled.div`
  padding: 0.95rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(201, 111, 59, 0.08);
  border: 1px solid rgba(201, 111, 59, 0.18);
`;

export const ReportEffectsPanel = styled.div`
  ${gridStackCss("1rem")};
`;

export const ReportEffectCard = styled(CapabilitySurface)`
  padding: 1rem;
  gap: 0.8rem;
  min-width: 0;
`;

export const CapabilityMetaText = styled(MetaText)``;
