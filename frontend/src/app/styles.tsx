import styled, { css } from "styled-components";

export const cardChromeCss = css`
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
`;

export const panelSurfaceCss = css`
  ${cardChromeCss};
  background: var(--panel);
`;

export const strongSurfaceCss = css`
  ${cardChromeCss};
  background: var(--panel-strong);
`;

export const warmSurfaceCss = css`
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: rgba(255, 251, 245, 0.86);
`;

export const inputSurfaceCss = css`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.8rem 0.9rem;
  background: rgba(255, 255, 255, 0.75);
`;

export const dashedInputSurfaceCss = css`
  border-radius: var(--radius-md);
  border: 1px dashed var(--line);
  padding: 0.9rem;
  background: rgba(255, 255, 255, 0.72);
`;

export const primaryButtonCss = css`
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 0.95rem 1.25rem;
  color: white;
  font-weight: 700;
  cursor: pointer;
`;

export const stackedListCss = css`
  margin: 0;
  display: grid;
`;

export const emptyStateCss = css`
  display: grid;
  place-items: center;
  text-align: center;
`;

export const displayHeadingCss = css`
  font-family: var(--font-display);
`;

export const gridStackCss = (gap = "1rem") => css`
  display: grid;
  gap: ${gap};
`;

export const flexWrapRowCss = (gap = "0.75rem") => css`
  display: flex;
  gap: ${gap};
  flex-wrap: wrap;
`;

export const secondaryButtonCss = css`
  ${primaryButtonCss};
  background: rgba(31, 41, 55, 0.12);
  color: var(--ink);
`;

export const sectionPanelCss = (padding = "1.2rem", gap = "1rem") => css`
  ${panelSurfaceCss};
  padding: ${padding};
  ${gridStackCss(gap)};
`;

export const tableHeaderCellCss = css`
  text-align: left;
  border-bottom: 1px solid rgba(31, 41, 55, 0.14);
`;

export const tableBodyCellCss = css`
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
`;

export const MetaText = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.65;
`;

export const AppEmptyState = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.6rem;
  display: grid;
  gap: 0.8rem;
`;

export const AppEmptyMetaText = styled(MetaText)``;
