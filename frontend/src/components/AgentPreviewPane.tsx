import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { publishToast } from "../app/toasts";
import { parseSavedChartArtifact } from "../lib/chart-artifacts";
import {
  resolveReportChartImageDataUrl,
  resolveReportChartSourceLabel,
  resolveReportImageDataUrl,
  resolveReportImageSourceLabel,
} from "../lib/report-chart-preview";
import { downloadReportPdf, type ReportPdfProgress } from "../lib/report-pdf";
import { listFileResources, resourceFile } from "../lib/shell-resources";
import {
  buildWorkspaceFilePayload,
  downloadWorkspaceFile,
  formatByteSize,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import type { AgentPreviewModel, AgentResourceRecord } from "../types/shell";
import type {
  LocalWorkspaceFile,
} from "../types/report";
import type {
  ReportChartPanelV1,
  ReportImagePanelV1,
  ReportSlideLayout,
  ReportSlidePanelV1,
} from "../types/workspace-contract";
import { WorkspaceArtifactInspector } from "./WorkspaceArtifactInspector";

function usePreviewUrl(resource: AgentResourceRecord | null): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const file = resource ? resourceFile(resource) : null;
    if (!file || file.kind !== "pdf") {
      setPreviewUrl(null);
      return;
    }
    const payload = buildWorkspaceFilePayload(file);
    const nextUrl = URL.createObjectURL(payload.blob);
    setPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [resource]);

  return previewUrl;
}

function summarizeResourceMeta(resource: AgentResourceRecord): string {
  if (resource.payload.type === "dataset") {
    return `${resource.payload.file.row_count} rows · ${resource.payload.file.columns.length} columns`;
  }
  if (resource.payload.type === "image") {
    return `${resource.payload.file.width} x ${resource.payload.file.height}`;
  }
  if (resource.payload.type === "document" && resource.payload.file.kind === "pdf") {
    return `${resource.payload.file.page_count} pages`;
  }
  if (resource.payload.type === "report") {
    return resource.payload.report.slides.length === 1
      ? "1 slide"
      : `${resource.payload.report.slides.length} slides`;
  }
  const file = resourceFile(resource);
  return formatByteSize(file?.byte_size);
}

function renderReportPanel(
  files: LocalWorkspaceFile[],
  panel: ReportSlidePanelV1,
) {
  if (panel.type === "narrative") {
    return (
      <ReportPanelCard data-panel-type={panel.type} key={panel.id}>
        <ReportPanelHeader>
          <strong>{panel.title}</strong>
          <span>Narrative</span>
        </ReportPanelHeader>
        <ReportPanelBody>
          <ReportMarkdownPanel>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{panel.markdown}</ReactMarkdown>
          </ReportMarkdownPanel>
        </ReportPanelBody>
      </ReportPanelCard>
    );
  }

  if (panel.type === "chart") {
    return renderReportChartPanel(files, panel);
  }

  return renderReportImagePanel(files, panel);
}

function renderReportChartPanel(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
) {
  const imageUrl = resolveReportChartImageDataUrl(files, panel);
  const sourceLabel = resolveReportChartSourceLabel(files, panel);

  return (
    <ReportPanelCard data-panel-type={panel.type} key={panel.id}>
      <ReportPanelHeader>
        <strong>{panel.title}</strong>
        <span>Chart</span>
      </ReportPanelHeader>
      <ReportPanelBody>
        {imageUrl ? (
          <ReportPanelImage alt={panel.title} src={imageUrl} />
        ) : (
          <ReportPanelPlaceholder>Chart preview unavailable for this slide.</ReportPanelPlaceholder>
        )}
      </ReportPanelBody>
      <ReportPanelMeta>Source: {sourceLabel}</ReportPanelMeta>
    </ReportPanelCard>
  );
}

function renderReportImagePanel(
  files: LocalWorkspaceFile[],
  panel: ReportImagePanelV1,
) {
  const imageUrl = resolveReportImageDataUrl(files, panel);
  const sourceLabel = resolveReportImageSourceLabel(files, panel);

  return (
    <ReportPanelCard data-panel-type={panel.type} key={panel.id}>
      <ReportPanelHeader>
        <strong>{panel.title}</strong>
        <span>Image</span>
      </ReportPanelHeader>
      <ReportPanelBody>
        {imageUrl ? (
          <ReportPanelImage alt={panel.alt_text ?? panel.title} src={imageUrl} />
        ) : (
          <ReportPanelPlaceholder>Image preview unavailable for this slide.</ReportPanelPlaceholder>
        )}
      </ReportPanelBody>
      <ReportPanelMeta>Source: {sourceLabel}</ReportPanelMeta>
    </ReportPanelCard>
  );
}

function renderReportPreview(
  resource: AgentResourceRecord,
  files: LocalWorkspaceFile[],
  activeSlideIndex: number,
  onSelectSlide: (index: number) => void,
) {
  if (resource.payload.type !== "report") {
    return null;
  }
  const report = resource.payload.report;
  const activeSlide = report.slides[activeSlideIndex] ?? report.slides[0] ?? null;
  const canGoPrev = activeSlideIndex > 0;
  const canGoNext = activeSlideIndex < report.slides.length - 1;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" && canGoPrev) {
      event.preventDefault();
      onSelectSlide(activeSlideIndex - 1);
    }
    if (event.key === "ArrowRight" && canGoNext) {
      event.preventDefault();
      onSelectSlide(activeSlideIndex + 1);
    }
  }

  return (
    <ReportPreview>
      {report.slides.length && activeSlide ? (
        <ReportSlideDeck>
          <ReportSlideViewport
            data-testid="report-slide-viewport"
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            {canGoPrev ? (
              <ReportSlideHotspot
                aria-label="Previous slide"
                data-testid="report-slide-prev"
                onClick={() => onSelectSlide(activeSlideIndex - 1)}
                $side="left"
                type="button"
              >
                <ReportSlideHotspotArrow>&lsaquo;</ReportSlideHotspotArrow>
              </ReportSlideHotspot>
            ) : null}
            {canGoNext ? (
              <ReportSlideHotspot
                aria-label="Next slide"
                data-testid="report-slide-next"
                onClick={() => onSelectSlide(activeSlideIndex + 1)}
                $side="right"
                type="button"
              >
                <ReportSlideHotspotArrow>&rsaquo;</ReportSlideHotspotArrow>
              </ReportSlideHotspot>
            ) : null}
            <ReportSlidePage key={activeSlide.id}>
              <ReportSlideHeader>
                <div>
                  <ReportSlideEyebrow>{report.title}</ReportSlideEyebrow>
                  <ReportSlideTitle>{activeSlide.title}</ReportSlideTitle>
                </div>
                <ReportSlideCounter>
                  Slide {activeSlideIndex + 1} of {report.slides.length}
                </ReportSlideCounter>
              </ReportSlideHeader>
              <ReportSlideGrid $layout={activeSlide.layout}>
                {activeSlide.panels.map((panel) => renderReportPanel(files, panel))}
              </ReportSlideGrid>
            </ReportSlidePage>
          </ReportSlideViewport>
          {report.slides.length > 1 ? (
            <ReportSlideProgress>
              {report.slides.map((slide, index) => (
                <ReportSlideDot
                  key={slide.id}
                  aria-label={`Go to slide ${index + 1}`}
                  $active={index === activeSlideIndex}
                  onClick={() => onSelectSlide(index)}
                  type="button"
                />
              ))}
            </ReportSlideProgress>
          ) : null}
        </ReportSlideDeck>
      ) : (
        <MetaText>No slides yet.</MetaText>
      )}
    </ReportPreview>
  );
}

function renderResourcePreview(resource: AgentResourceRecord, previewUrl: string | null) {
  if (resource.payload.type === "report") {
    return null;
  }

  const file = resourceFile(resource);
  if (!file) {
    return <MetaText>No preview is available for this export.</MetaText>;
  }

  if (resource.payload.type === "chart") {
    const chartArtifact = parseSavedChartArtifact(file);
    if (chartArtifact?.imageDataUrl) {
      return <PreviewImage alt={resource.title} src={chartArtifact.imageDataUrl} />;
    }
  }

  if (file.kind === "image") {
    return <PreviewImage alt={file.name} src={`data:${file.mime_type};base64,${file.bytes_base64}`} />;
  }

  if (file.kind === "pdf" && previewUrl) {
    return <PreviewFrame src={previewUrl} title={file.name} />;
  }

  if (file.kind === "csv" || file.kind === "json") {
    return <WorkspaceArtifactInspector files={[file]} />;
  }

  if (file.kind === "other" && file.text_content) {
    if (file.extension === "md") {
      return (
        <MarkdownPreview>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.text_content}</ReactMarkdown>
        </MarkdownPreview>
      );
    }
    return <TextPreview>{file.text_content}</TextPreview>;
  }

  return <MetaText>Preview unavailable in shell. Open or download this export to inspect it directly.</MetaText>;
}

export function AgentPreviewPane({
  assetResources,
  previewModel,
  resources,
  selectedResourceId,
}: {
  assetResources?: AgentResourceRecord[];
  previewModel: AgentPreviewModel;
  resources: AgentResourceRecord[];
  selectedResourceId?: string | null;
}) {
  const [uncontrolledSelectedResourceId, setUncontrolledSelectedResourceId] = useState<string | null>(
    previewModel.items[0]?.resource_id ?? null,
  );
  const [activeReportSlideIndex, setActiveReportSlideIndex] = useState(0);
  const [reportExportProgress, setReportExportProgress] = useState<ReportPdfProgress | null>(null);
  const resolvedSelectedResourceId =
    selectedResourceId !== undefined
      ? selectedResourceId === null
        ? null
        : resources.some((resource) => resource.id === selectedResourceId)
          ? selectedResourceId
          : previewModel.items[0]?.resource_id ?? resources[0]?.id ?? null
      : uncontrolledSelectedResourceId;

  useEffect(() => {
    if (selectedResourceId !== undefined) {
      return;
    }
    if (!previewModel.items.length && !resources.length) {
      setUncontrolledSelectedResourceId(null);
      return;
    }
    setUncontrolledSelectedResourceId((current) =>
      current && resources.some((resource) => resource.id === current)
        ? current
        : previewModel.items[0]?.resource_id ?? resources[0]?.id ?? null,
    );
  }, [previewModel, resources, selectedResourceId]);

  const selectedResource = useMemo(
    () =>
      resources.find((resource) => resource.id === resolvedSelectedResourceId) ??
      resources[0] ??
      null,
    [resolvedSelectedResourceId, resources],
  );
  const previewUrl = usePreviewUrl(selectedResource);
  const selectedFile = selectedResource ? resourceFile(selectedResource) : null;
  const selectedReport =
    selectedResource?.payload.type === "report" ? selectedResource.payload.report : null;
  const reportAssetFiles = useMemo(
    () => listFileResources(assetResources ?? resources),
    [assetResources, resources],
  );

  useEffect(() => {
    setActiveReportSlideIndex(0);
  }, [selectedReport?.report_id]);

  useEffect(() => {
    if (!selectedReport) {
      setActiveReportSlideIndex(0);
      return;
    }
    setActiveReportSlideIndex((current) =>
      Math.min(current, Math.max(selectedReport.slides.length - 1, 0)),
    );
  }, [selectedReport]);

  async function exportReportPdf() {
    if (!selectedResource || !selectedReport) {
      return;
    }

    if (!selectedReport.slides.length) {
      publishToast({
        title: "Nothing to print",
        message: "Add at least one slide to the report before printing it as a PDF.",
        tone: "warning",
      });
      return;
    }

    setReportExportProgress({
      phase: "preparing",
      totalPages: selectedReport.slides.length,
    });
    try {
      await downloadReportPdf({
        files: reportAssetFiles,
        onProgress: setReportExportProgress,
        report: selectedReport,
      });
    } catch (error) {
      publishToast({
        title: "Unable to export PDF",
        message:
          error instanceof Error
            ? error.message
            : "The report could not be rendered into a PDF in this browser session.",
        tone: "error",
      });
    } finally {
      setReportExportProgress(null);
    }
  }

  const reportExportLabel =
    reportExportProgress == null
      ? "Export PDF"
      : reportExportProgress.phase === "preparing"
        ? "Preparing PDF..."
        : reportExportProgress.phase === "assembling"
          ? "Finalizing PDF..."
          : `Rendering ${reportExportProgress.currentPage} / ${reportExportProgress.totalPages}...`;

  return (
    <PreviewShell data-testid="agent-preview-pane">
      <PreviewBody data-testid="agent-preview-canvas">
        {selectedResource ? (
          <>
            <PreviewToolbar>
              <PreviewSelectionMeta>
                <strong>{selectedResource.title}</strong>
                <span>{summarizeResourceMeta(selectedResource)}</span>
              </PreviewSelectionMeta>
              {selectedReport ? (
                <PreviewActions>
                  <PreviewActionButton
                    disabled={!selectedReport.slides.length || reportExportProgress != null}
                    onClick={() => {
                      void exportReportPdf();
                    }}
                    type="button"
                  >
                    {reportExportLabel}
                  </PreviewActionButton>
                </PreviewActions>
              ) : selectedFile ? (
                <PreviewActions>
                  <PreviewActionButton onClick={() => openWorkspaceFileInNewTab(selectedFile)} type="button">
                    Open
                  </PreviewActionButton>
                  <PreviewActionButton onClick={() => downloadWorkspaceFile(selectedFile)} type="button">
                    Download
                  </PreviewActionButton>
                </PreviewActions>
              ) : null}
            </PreviewToolbar>
            <PreviewCanvas>
              {selectedReport
                ? renderReportPreview(
                    selectedResource,
                    reportAssetFiles,
                    activeReportSlideIndex,
                    setActiveReportSlideIndex,
                  )
                : renderResourcePreview(selectedResource, previewUrl)}
            </PreviewCanvas>
          </>
        ) : (
          <PreviewEmptyState>
            {resources.length
              ? "Select a workspace file or output to inspect it here."
              : "No files yet for this workspace."}
          </PreviewEmptyState>
        )}
      </PreviewBody>
    </PreviewShell>
  );
}

const PreviewShell = styled.section`
  min-height: 0;
  height: 100%;
`;

const PreviewBody = styled.section`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  gap: 0.8rem;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 1rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 242, 236, 0.78)),
    rgba(255, 255, 255, 0.72);
  overflow: hidden;
`;

const PreviewToolbar = styled.div`
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.7rem;
  flex-wrap: wrap;
`;

const PreviewSelectionMeta = styled.div`
  display: grid;
  gap: 0.16rem;

  strong {
    font-size: 0.86rem;
    line-height: 1.12;
    color: var(--ink);
  }

  span {
    font-size: 0.74rem;
    line-height: 1.35;
    color: var(--muted);
  }
`;

const PreviewCanvas = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  align-items: stretch;
  gap: 0.8rem;
`;

const PreviewImage = styled.img`
  width: 100%;
  min-height: clamp(260px, 38vh, 420px);
  max-height: clamp(360px, 58vh, 680px);
  object-fit: contain;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(248, 246, 242, 0.82);
`;

const PreviewFrame = styled.iframe`
  width: 100%;
  min-height: clamp(360px, 56vh, 720px);
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: 18px;
  background: white;
`;

const MarkdownPreview = styled.div`
  min-width: 0;
  padding: 0.9rem 1rem;
  border-radius: 18px;
  background: rgba(248, 246, 242, 0.82);
  border: 1px solid rgba(31, 41, 55, 0.08);
  color: var(--ink);

  p,
  ul,
  ol {
    margin: 0 0 0.75rem;
  }

  > :last-child {
    margin-bottom: 0;
  }
`;

const TextPreview = styled.pre`
  margin: 0;
  padding: 0.9rem 1rem;
  border-radius: 18px;
  background: rgba(248, 246, 242, 0.82);
  border: 1px solid rgba(31, 41, 55, 0.08);
  color: var(--ink);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ReportPreview = styled.div`
  min-height: 0;
  height: 100%;
  display: grid;
  align-items: stretch;
`;

const ReportSlideDeck = styled.div`
  min-height: 0;
  height: 100%;
  display: grid;
  gap: 0.55rem;
  grid-template-rows: minmax(0, 1fr) auto;
`;

const ReportSlideViewport = styled.div`
  position: relative;
  min-height: 0;
  height: 100%;
  display: grid;
  place-items: center;
  outline: none;
`;

const ReportSlidePage = styled.article`
  width: 100%;
  max-width: calc(min(72vh, 760px) * 16 / 9);
  height: auto;
  aspect-ratio: 16 / 9;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.8rem;
  padding: 0.95rem;
  border-radius: 22px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    radial-gradient(circle at top right, rgba(201, 111, 59, 0.08), transparent 26%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 244, 238, 0.96));
  box-shadow: 0 18px 40px rgba(53, 39, 28, 0.08);
`;

const ReportSlideHotspot = styled.button<{ $side: "left" | "right" }>`
  position: absolute;
  ${({ $side }) => ($side === "left" ? "left: 0.38rem;" : "right: 0.38rem;")}
  top: 0.42rem;
  bottom: 0.42rem;
  width: clamp(40px, 7%, 58px);
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 18px;
  background: transparent;
  cursor: pointer;
  z-index: 2;

  &:hover {
    background: linear-gradient(
      ${({ $side }) => ($side === "left" ? "90deg" : "270deg")},
      rgba(31, 41, 55, 0.08),
      transparent 72%
    );
  }
`;

const ReportSlideHotspotArrow = styled.span`
  width: 1.9rem;
  height: 1.9rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(31, 41, 55, 0.1);
  color: var(--muted);
  font-size: 1.3rem;
  line-height: 1;
  box-shadow: 0 10px 26px rgba(32, 26, 20, 0.08);
`;

const ReportSlideHeader = styled.header`
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.7rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.12);
`;

const ReportSlideEyebrow = styled.div`
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const ReportSlideTitle = styled.h3`
  margin: 0.12rem 0 0;
  font-family: var(--font-display);
  font-size: 1.18rem;
  line-height: 1.02;
`;

const ReportSlideCounter = styled.div`
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.76rem;
  line-height: 1.2;
  white-space: nowrap;
`;

const ReportSlideProgress = styled.div`
  display: flex;
  justify-content: center;
  gap: 0.34rem;
`;

const ReportSlideDot = styled.button<{ $active: boolean }>`
  width: ${({ $active }) => ($active ? "1.5rem" : "0.52rem")};
  height: 0.52rem;
  border: 0;
  border-radius: 999px;
  background: ${({ $active }) =>
    $active ? "var(--accent)" : "rgba(31, 41, 55, 0.14)"};
  cursor: pointer;
  transition:
    width 180ms ease,
    background 180ms ease;
`;

const reportSlideLayoutStyles = {
  "1x1": `
    grid-template-columns: minmax(0, 1fr);
  `,
  "1x2": `
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  `,
  "2x2": `
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  `,
} satisfies Record<ReportSlideLayout, string>;

const ReportSlideGrid = styled.section<{ $layout: ReportSlideLayout }>`
  min-height: 0;
  display: grid;
  gap: 0.7rem;
  ${({ $layout }) => reportSlideLayoutStyles[$layout]}

  @media (max-width: 880px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
  }
`;

const ReportPanelCard = styled.section`
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.42rem;
  padding: 0.75rem;
  border-radius: 16px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.9);
  overflow: hidden;
`;

const ReportPanelHeader = styled.header`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;

  strong {
    font-size: 0.88rem;
    line-height: 1.2;
    color: var(--ink);
  }

  span {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
`;

const ReportPanelBody = styled.div`
  min-height: 0;
  display: grid;
  align-items: stretch;
  overflow: hidden;
`;

const ReportPanelImage = styled.img`
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  border-radius: 14px;
  background: rgba(247, 243, 237, 0.84);
`;

const ReportPanelPlaceholder = styled.div`
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 1rem;
  border-radius: 14px;
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(247, 243, 237, 0.72);
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
`;

const ReportPanelMeta = styled.div`
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.35;
`;

const ReportMarkdownPanel = styled.div`
  min-height: 0;
  overflow: auto;
  color: var(--ink);
  font-size: 0.84rem;
  line-height: 1.55;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0 0 0.55rem;
    font-family: var(--font-display);
    line-height: 1.05;
  }

  h1 {
    font-size: 1.34rem;
  }

  h2 {
    font-size: 1.12rem;
  }

  h3 {
    font-size: 0.98rem;
  }

  p,
  ul,
  ol,
  blockquote,
  pre,
  table {
    margin: 0 0 0.7rem;
  }

  ul,
  ol {
    padding-left: 1.1rem;
  }

  li + li {
    margin-top: 0.2rem;
  }

  blockquote {
    padding-left: 0.75rem;
    border-left: 3px solid rgba(201, 111, 59, 0.28);
    color: color-mix(in srgb, var(--ink) 86%, white 14%);
  }

  code {
    font-family: "SFMono-Regular", "Consolas", monospace;
    font-size: 0.78rem;
    background: rgba(31, 41, 55, 0.08);
    border-radius: 6px;
    padding: 0.05rem 0.24rem;
  }

  pre {
    overflow: auto;
    padding: 0.75rem;
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
    font-size: 0.76rem;
  }

  th,
  td {
    padding: 0.4rem 0.45rem;
    border: 1px solid rgba(31, 41, 55, 0.12);
    text-align: left;
    vertical-align: top;
  }
`;

const PreviewActions = styled.div`
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const PreviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: 999px;
  padding: 0.48rem 0.8rem;
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const PreviewEmptyState = styled(MetaText)`
  padding: 0.4rem 0;
  align-self: center;
`;
