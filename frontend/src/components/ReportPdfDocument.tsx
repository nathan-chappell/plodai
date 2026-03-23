import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import {
  resolveReportChartImageDataUrl,
  resolveReportChartSourceLabel,
  resolveReportImageDataUrl,
  resolveReportImageSourceLabel,
} from "../lib/report-chart-preview";
import { getReportSlideGridTemplate } from "../lib/report-slide-layout";
import type { LocalAttachment } from "../types/report";
import type {
  ReportChartPanelV1,
  ReportImagePanelV1,
  ReportSlideLayout,
  ReportSlidePanelV1,
  WorkspaceReportV1,
} from "../types/workspace-contract";

export const REPORT_PDF_PAGE_SELECTOR = "[data-report-pdf-page='true']";

export function collectReportAssetUrls(
  report: WorkspaceReportV1,
  files: LocalAttachment[],
): string[] {
  const urls = new Set<string>();

  for (const slide of report.slides) {
    for (const panel of slide.panels) {
      if (panel.type === "chart") {
        const chartUrl = resolveReportChartImageDataUrl(files, panel);
        if (chartUrl) {
          urls.add(chartUrl);
        }
      }

      if (panel.type === "image") {
        const imageUrl = resolveReportImageDataUrl(files, panel);
        if (imageUrl) {
          urls.add(imageUrl);
        }
      }
    }
  }

  return [...urls];
}

export async function preloadReportAssetUrls(urls: string[]): Promise<void> {
  if (typeof window === "undefined" || !urls.length) {
    return;
  }

  await Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url;
        }),
    ),
  );
}

function renderPanel(
  files: LocalAttachment[],
  panel: ReportSlidePanelV1,
) {
  if (panel.type === "narrative") {
    return (
      <PanelCard data-panel-type={panel.type} key={panel.id}>
        <PanelHeader>
          <PanelTitle>{panel.title}</PanelTitle>
          <PanelKind>Narrative</PanelKind>
        </PanelHeader>
        <PanelBody>
          <MarkdownPanel>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{panel.markdown}</ReactMarkdown>
          </MarkdownPanel>
        </PanelBody>
      </PanelCard>
    );
  }

  if (panel.type === "chart") {
    return renderChartPanel(files, panel);
  }

  return renderImagePanel(files, panel);
}

function renderChartPanel(
  files: LocalAttachment[],
  panel: ReportChartPanelV1,
) {
  const imageUrl = resolveReportChartImageDataUrl(files, panel);
  const sourceLabel = resolveReportChartSourceLabel(files, panel);

  return (
    <PanelCard data-panel-type={panel.type} key={panel.id}>
      <PanelHeader>
        <PanelTitle>{panel.title}</PanelTitle>
        <PanelKind>Chart</PanelKind>
      </PanelHeader>
      <PanelBody>
        {imageUrl ? (
          <PanelImage
            alt={panel.title}
            src={imageUrl}
          />
        ) : (
          <PanelPlaceholder>Chart preview unavailable for this slide.</PanelPlaceholder>
        )}
      </PanelBody>
      <PanelMetaText>Source: {sourceLabel}</PanelMetaText>
    </PanelCard>
  );
}

function renderImagePanel(
  files: LocalAttachment[],
  panel: ReportImagePanelV1,
) {
  const imageUrl = resolveReportImageDataUrl(files, panel);
  const sourceLabel = resolveReportImageSourceLabel(files, panel);

  return (
    <PanelCard data-panel-type={panel.type} key={panel.id}>
      <PanelHeader>
        <PanelTitle>{panel.title}</PanelTitle>
        <PanelKind>Image</PanelKind>
      </PanelHeader>
      <PanelBody>
        {imageUrl ? (
          <PanelImage
            alt={panel.alt_text ?? panel.title}
            src={imageUrl}
          />
        ) : (
          <PanelPlaceholder>Image preview unavailable for this slide.</PanelPlaceholder>
        )}
      </PanelBody>
      <PanelMetaText>Source: {sourceLabel}</PanelMetaText>
    </PanelCard>
  );
}

export function ReportPdfDocument({
  files,
  report,
  pageTestId,
}: {
  files: LocalAttachment[];
  report: WorkspaceReportV1;
  pageTestId?: string;
}) {
  return (
    <DocumentStack data-testid="report-pdf-document">
      {report.slides.map((slide, index) => (
        <DocumentPage data-report-pdf-page="true" data-testid={pageTestId} key={slide.id}>
          <SlideCard>
            <SlideHeader>
              <SlideHeaderText>
                <SlideEyebrow>{report.title}</SlideEyebrow>
                <SlideTitle>{slide.title}</SlideTitle>
              </SlideHeaderText>
              <SlideCounter>
                Slide {index + 1} of {report.slides.length}
              </SlideCounter>
            </SlideHeader>
            <SlideGrid $layout={slide.layout}>
              {slide.panels.map((panel) => renderPanel(files, panel))}
            </SlideGrid>
          </SlideCard>
        </DocumentPage>
      ))}
    </DocumentStack>
  );
}

const DocumentStack = styled.section`
  display: grid;
  gap: 1rem;
  justify-items: center;
`;

const DocumentPage = styled.article`
  width: 11in;
  height: 8.5in;
  padding: 0.45in;
  display: grid;
  background: white;
  color: var(--ink);
  overflow: hidden;
`;

const SlideCard = styled.section`
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.32in;
  padding: 0.34in;
  border-radius: 26px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    radial-gradient(circle at top right, rgba(201, 111, 59, 0.08), transparent 26%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 244, 238, 0.96));
  box-shadow: 0 24px 50px rgba(53, 39, 28, 0.11);
  overflow: hidden;
`;

const SlideHeader = styled.header`
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.35in;
  border-bottom: 1px solid rgba(31, 41, 55, 0.12);
  padding-bottom: 0.18in;
`;

const SlideHeaderText = styled.div`
  min-width: 0;
  display: grid;
  gap: 0.07in;
`;

const SlideEyebrow = styled.div`
  font-size: 0.11in;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 800;
  color: var(--accent-deep);
`;

const SlideTitle = styled.h1`
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.34in;
  line-height: 0.98;
`;

const SlideCounter = styled.div`
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.14in;
  line-height: 1.2;
  white-space: nowrap;
`;

const SlideGrid = styled.section<{ $layout: ReportSlideLayout }>`
  min-height: 0;
  display: grid;
  gap: 0.22in;
  grid-template-columns: ${({ $layout }) => getReportSlideGridTemplate($layout).columns};
  ${({ $layout }) => {
    const { rows } = getReportSlideGridTemplate($layout);
    return rows ? `grid-template-rows: ${rows};` : "";
  }}
`;

const PanelCard = styled.section`
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.12in;
  padding: 0.18in;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  break-inside: avoid;
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.18in;
`;

const PanelTitle = styled.strong`
  font-size: 0.18in;
  line-height: 1.2;
`;

const PanelKind = styled.span`
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.11in;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const PanelBody = styled.div`
  min-height: 0;
  display: grid;
  align-items: stretch;
  overflow: hidden;
`;

const PanelImage = styled.img`
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  border-radius: 14px;
  background: rgba(247, 243, 237, 0.84);
`;

const PanelPlaceholder = styled.div`
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 0.2in;
  border-radius: 14px;
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(247, 243, 237, 0.72);
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
`;

const PanelMetaText = styled.div`
  color: var(--muted);
  font-size: 0.11in;
  line-height: 1.35;
`;

const MarkdownPanel = styled.div`
  min-height: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 0.145in;
  line-height: 1.45;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0 0 0.1in;
    font-family: var(--font-display);
    line-height: 1.05;
  }

  h1 {
    font-size: 0.26in;
  }

  h2 {
    font-size: 0.22in;
  }

  h3 {
    font-size: 0.18in;
  }

  p,
  ul,
  ol,
  blockquote,
  pre,
  table {
    margin: 0 0 0.12in;
  }

  ul,
  ol {
    padding-left: 0.22in;
  }

  li + li {
    margin-top: 0.04in;
  }

  blockquote {
    padding-left: 0.14in;
    border-left: 3px solid rgba(201, 111, 59, 0.28);
    color: color-mix(in srgb, var(--ink) 86%, white 14%);
  }

  code {
    font-family: "SFMono-Regular", "Consolas", monospace;
    font-size: 0.125in;
    background: rgba(31, 41, 55, 0.08);
    border-radius: 6px;
    padding: 0.01in 0.04in;
  }

  pre {
    overflow: hidden;
    padding: 0.14in;
    border-radius: 12px;
    background: rgba(31, 41, 55, 0.94);
    color: #f8fafc;
  }

  pre code {
    padding: 0;
    background: transparent;
    color: inherit;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.12in;
  }

  th,
  td {
    padding: 0.08in;
    border: 1px solid rgba(31, 41, 55, 0.12);
    text-align: left;
    vertical-align: top;
  }

  th {
    background: rgba(247, 243, 237, 0.92);
    font-weight: 800;
  }

  a {
    color: var(--accent-deep);
    text-decoration-thickness: 1px;
  }

  img {
    max-width: 100%;
  }

  > :last-child {
    margin-bottom: 0;
  }
`;
