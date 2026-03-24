import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { publishToast } from "../app/toasts";
import {
  resolveReportChartImageDataUrl,
  resolveReportChartSourceLabel,
  resolveReportImageDataUrl,
  resolveReportImageSourceLabel,
} from "../lib/report-chart-preview";
import { downloadReportPdf, type ReportPdfProgress } from "../lib/report-pdf";
import {
  buildWorkspaceFilePayload,
  downloadWorkspaceFile,
  formatByteSize,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import { getReportSlideGridTemplate } from "../lib/report-slide-layout";
import { FarmRecordPanel } from "./FarmRecordPanel";
import type { LocalPdfAttachment, LocalAttachment } from "../types/report";
import type {
  ChartItemPayloadV1,
  FarmItemPayloadV1,
  PdfSplitItemPayloadV1,
  WorkspaceCreatedItemDetail,
  WorkspaceCreatedItemSummary,
  WorkspaceUploadItemSummary,
} from "../types/workspace";
import type {
  ReportChartPanelV1,
  ReportImagePanelV1,
  ReportSlideLayout,
  ReportSlidePanelV1,
  WorkspaceReportV1,
} from "../types/workspace-contract";
import { WorkspaceArtifactInspector } from "./WorkspaceArtifactInspector";

export type PreviewSelection =
  | { kind: "file"; id: string }
  | { kind: "artifact"; id: string }
  | null;

function summarizeFileMeta(entry: WorkspaceUploadItemSummary): string {
  if (entry.kind === "csv" || entry.kind === "json") {
    return "row_count" in entry.preview
      ? `${entry.preview.row_count} rows · ${entry.preview.columns.length} columns`
      : "Dataset";
  }
  if (entry.kind === "pdf") {
    return "page_count" in entry.preview ? `${entry.preview.page_count} pages` : "PDF";
  }
  if (entry.kind === "image") {
    return "width" in entry.preview && "height" in entry.preview
      ? `${entry.preview.width} x ${entry.preview.height}`
      : "Image";
  }
  return formatByteSize(entry.byte_size ?? undefined);
}

function summarizeArtifactMeta(artifact: WorkspaceCreatedItemSummary): string {
  if (artifact.kind === "report.v1" && "slide_count" in artifact.summary) {
    return artifact.summary.slide_count === 1
      ? "1 slide"
      : `${artifact.summary.slide_count} slides`;
  }
  if (artifact.kind === "chart.v1" && "chart_plan_id" in artifact.summary) {
    return `Chart plan ${artifact.summary.chart_plan_id}`;
  }
  if (artifact.kind === "pdf_split.v1" && "entry_count" in artifact.summary) {
    return artifact.summary.entry_count === 1
      ? "1 split entry"
      : `${artifact.summary.entry_count} split entries`;
  }
  if (artifact.kind === "farm.v1" && "crop_count" in artifact.summary) {
    return `${artifact.summary.crop_count} crops · ${artifact.summary.issue_count} issues · ${artifact.summary.project_count} projects · ${artifact.summary.order_count ?? 0} orders`;
  }
  return artifact.kind;
}

function renderReportPanel(files: LocalAttachment[], panel: ReportSlidePanelV1) {
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

function renderReportChartPanel(files: LocalAttachment[], panel: ReportChartPanelV1) {
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

function renderReportImagePanel(files: LocalAttachment[], panel: ReportImagePanelV1) {
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
  report: WorkspaceReportV1,
  files: LocalAttachment[],
  activeSlideIndex: number,
  onSelectSlide: (index: number) => void,
) {
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

function PdfPreviewFrame({ file }: { file: LocalPdfAttachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const payload = buildWorkspaceFilePayload(file);
    const nextUrl = URL.createObjectURL(payload.blob);
    setUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file]);

  if (!url) {
    return <MetaText>Loading PDF preview…</MetaText>;
  }

  return <PreviewFrame src={url} title={file.name} />;
}

function renderLocalFilePreview(
  entry: WorkspaceUploadItemSummary,
  file: LocalAttachment | null,
) {
  if (!file) {
    return (
      <MissingPayloadCard>
        <strong>{entry.name}</strong>
        <MetaText>Local payload unavailable in this browser.</MetaText>
        <MetaText>{summarizeFileMeta(entry)}</MetaText>
      </MissingPayloadCard>
    );
  }

  if (file.kind === "image") {
    return <PreviewImage alt={file.name} src={`data:${file.mime_type};base64,${file.bytes_base64}`} />;
  }

  if (file.kind === "pdf") {
    return <PdfPreviewFrame file={file} />;
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

  return <MetaText>Preview unavailable in shell. Open or download this file to inspect it directly.</MetaText>;
}

function renderArtifactPreview(
  artifact: WorkspaceCreatedItemDetail,
  files: LocalAttachment[],
  activeSlideIndex: number,
  onSelectSlide: (index: number) => void,
) {
  if (artifact.kind === "report.v1") {
    return renderReportPreview(artifact.payload as WorkspaceReportV1, files, activeSlideIndex, onSelectSlide);
  }
  if (artifact.kind === "chart.v1") {
    const chart = artifact.payload as ChartItemPayloadV1;
    return chart.image_data_url ? (
      <PreviewImage alt={artifact.title} src={chart.image_data_url} />
    ) : (
      <MetaText>This chart item does not include a preview image yet.</MetaText>
    );
  }
  if (artifact.kind === "farm.v1") {
    return <FarmRecordPanel dataTestId="farm-preview" farm={artifact.payload as FarmItemPayloadV1} />;
  }
  const pdfSplit = artifact.payload as PdfSplitItemPayloadV1;
  return (
    <ArtifactMarkdownPreview>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{pdfSplit.markdown}</ReactMarkdown>
    </ArtifactMarkdownPreview>
  );
}

export function AgentPreviewPane({
  files,
  artifacts,
  resolveLocalFile,
  resolveSupplementalLocalFile,
  getArtifact,
  selectedItem,
}: {
  files: WorkspaceUploadItemSummary[];
  artifacts: WorkspaceCreatedItemSummary[];
  resolveLocalFile: (fileId: string) => Promise<LocalAttachment | null>;
  resolveSupplementalLocalFile?: (fileId: string) => Promise<LocalAttachment | null>;
  getArtifact: (artifactId: string) => Promise<WorkspaceCreatedItemDetail | null>;
  selectedItem: PreviewSelection;
}) {
  const [selectedFile, setSelectedFile] = useState<LocalAttachment | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<WorkspaceCreatedItemDetail | null>(null);
  const [activeReportSlideIndex, setActiveReportSlideIndex] = useState(0);
  const [reportExportProgress, setReportExportProgress] = useState<ReportPdfProgress | null>(null);

  const selectedFileEntry = useMemo(
    () =>
      selectedItem?.kind === "file"
        ? files.find((file) => file.id === selectedItem.id) ?? null
        : null,
    [files, selectedItem],
  );
  const selectedArtifactSummary = useMemo(
    () =>
      selectedItem?.kind === "artifact"
        ? artifacts.find((artifact) => artifact.id === selectedItem.id) ?? null
        : null,
    [artifacts, selectedItem],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedFileEntry) {
      setSelectedFile(null);
      return;
    }
    void (async () => {
      const file = await resolveLocalFile(selectedFileEntry.id);
      if (!cancelled) {
        setSelectedFile(file);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveLocalFile, selectedFileEntry]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedArtifactSummary) {
      setSelectedArtifact(null);
      return;
    }
    void (async () => {
      const detail = await getArtifact(selectedArtifactSummary.id);
      if (!cancelled) {
        setSelectedArtifact(detail);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getArtifact, selectedArtifactSummary]);

  useEffect(() => {
    setActiveReportSlideIndex(0);
  }, [selectedArtifact?.id]);

  const loadedArtifactFiles = useMemo(
    () => files.filter((file) => file.local_status === "available"),
    [files],
  );
  const [artifactLocalFiles, setArtifactLocalFiles] = useState<LocalAttachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const workspaceResolved = await Promise.all(
        loadedArtifactFiles.map((file) => resolveLocalFile(file.id)),
      );
      const resolvedFiles = workspaceResolved.filter(
        (file): file is LocalAttachment => file !== null,
      );
      const resolvedFileIds = new Set(resolvedFiles.map((file) => file.id));
      const supplementalIds = collectArtifactReferencedImageFileIds(selectedArtifact).filter(
        (fileId) => !resolvedFileIds.has(fileId),
      );
      const supplementalResolved = resolveSupplementalLocalFile
        ? await Promise.all(
            supplementalIds.map((fileId) => resolveSupplementalLocalFile(fileId)),
          )
        : [];
      if (!cancelled) {
        setArtifactLocalFiles(
          [
            ...resolvedFiles,
            ...supplementalResolved.filter(
              (file): file is LocalAttachment => file !== null,
            ),
          ],
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedArtifactFiles, resolveLocalFile, resolveSupplementalLocalFile, selectedArtifact]);

  async function exportReportPdf() {
    if (!selectedArtifact || selectedArtifact.kind !== "report.v1") {
      return;
    }
    try {
      setReportExportProgress({
        phase: "preparing",
        totalPages: Math.max((selectedArtifact.payload as WorkspaceReportV1).slides.length, 1),
      });
      await downloadReportPdf({
        report: selectedArtifact.payload as WorkspaceReportV1,
        files: artifactLocalFiles,
        onProgress: (progress) => setReportExportProgress(progress),
      });
      publishToast({
        title: "PDF export complete",
        message: `Saved ${selectedArtifact.title} as a PDF.`,
        tone: "info",
      });
    } catch (error) {
      publishToast({
        title: "PDF export failed",
        message: error instanceof Error ? error.message : "Unable to export the current report.",
        tone: "error",
      });
    } finally {
      setReportExportProgress(null);
    }
  }

  if (!selectedItem) {
    return (
      <PaneCard>
        <MetaText>Select an upload or created item from the workspace to preview it here.</MetaText>
      </PaneCard>
    );
  }

  if (selectedFileEntry) {
    return (
      <PaneCard>
        <PaneHeader>
          <div>
            <PaneTitle>{selectedFileEntry.name}</PaneTitle>
            <MetaText>{summarizeFileMeta(selectedFileEntry)}</MetaText>
          </div>
          {selectedFile ? (
            <PaneActionRow>
              {(selectedFile.kind === "pdf" ||
                selectedFile.kind === "json" ||
                selectedFile.kind === "image" ||
                (selectedFile.kind === "other" && selectedFile.text_content != null)) ? (
                <PaneButton onClick={() => openWorkspaceFileInNewTab(selectedFile)} type="button">
                  Open file
                </PaneButton>
              ) : null}
              <PaneButton onClick={() => downloadWorkspaceFile(selectedFile)} type="button">
                Download
              </PaneButton>
            </PaneActionRow>
          ) : null}
        </PaneHeader>
        {renderLocalFilePreview(selectedFileEntry, selectedFile)}
      </PaneCard>
    );
  }

  if (selectedArtifactSummary) {
    return (
      <PaneCard>
        <PaneHeader>
          <div>
            <PaneTitle>{selectedArtifactSummary.title}</PaneTitle>
            <MetaText>{summarizeArtifactMeta(selectedArtifactSummary)}</MetaText>
            {selectedArtifactSummary.last_edited_by_agent_id ? (
              <MetaText>Last edited by {selectedArtifactSummary.last_edited_by_agent_id}</MetaText>
            ) : null}
          </div>
          {selectedArtifactSummary.kind === "report.v1" ? (
            <PaneActionRow>
              <PaneButton
                disabled={
                  reportExportProgress !== null ||
                  ((selectedArtifact?.payload as WorkspaceReportV1 | undefined)?.slides.length ?? 0) === 0
                }
                onClick={() => void exportReportPdf()}
                type="button"
              >
                {reportExportProgress ? "Exporting…" : "Export PDF"}
              </PaneButton>
            </PaneActionRow>
          ) : null}
        </PaneHeader>
        {selectedArtifact ? (
          <>
            {renderArtifactPreview(selectedArtifact, artifactLocalFiles, activeReportSlideIndex, setActiveReportSlideIndex)}
          </>
        ) : (
          <MetaText>Loading created item preview…</MetaText>
        )}
      </PaneCard>
    );
  }

  return (
    <PaneCard>
      <MetaText>Select an upload or created item from the workspace to preview it here.</MetaText>
    </PaneCard>
  );
}

function collectArtifactReferencedImageFileIds(
  artifact: WorkspaceCreatedItemDetail | null,
): string[] {
  if (!artifact || artifact.kind !== "report.v1") {
    return [];
  }

  const report = artifact.payload as WorkspaceReportV1;
  const referencedFileIds = new Set<string>();
  for (const slide of report.slides) {
    for (const panel of slide.panels) {
      if (panel.type === "image" && panel.file_id) {
        referencedFileIds.add(panel.file_id);
      }
    }
  }
  return [...referencedFileIds];
}

const PaneCard = styled.section`
  display: grid;
  gap: 0.8rem;
  min-height: 0;
  height: 100%;
  align-content: start;
  padding: 0.92rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(249, 244, 238, 0.9)),
    var(--panel);
`;

const PaneHeader = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
`;

const PaneTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
  line-height: 1.12;
`;


const PaneActionRow = styled.div`
  display: inline-flex;
  align-items: flex-start;
  gap: 0.45rem;
`;

const PaneButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.76);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.42rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.52;
  }
`;

const MissingPayloadCard = styled.div`
  display: grid;
  gap: 0.28rem;
  padding: 1rem;
  border-radius: var(--radius-lg);
  border: 1px dashed rgba(31, 41, 55, 0.18);
  background: rgba(255, 255, 255, 0.6);
`;

const PreviewImage = styled.img`
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.82);
`;

const PreviewFrame = styled.iframe`
  width: 100%;
  min-height: 560px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 18px;
  background: white;
`;

const MarkdownPreview = styled.div`
  max-height: 420px;
  overflow: auto;
  border-radius: 16px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.8rem;
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.55;

  p,
  ul,
  ol {
    margin: 0 0 0.5rem;
  }
`;

const ArtifactMarkdownPreview = styled(MarkdownPreview)`
  max-height: none;
`;

const TextPreview = styled.pre`
  margin: 0;
  max-height: 420px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink);
  padding: 0.85rem 0.95rem;
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const ReportPreview = styled.div`
  display: grid;
  gap: 1rem;
`;

const ReportSlideDeck = styled.div`
  display: grid;
  gap: 0.75rem;
`;

const ReportSlideViewport = styled.div`
  position: relative;
  outline: none;
`;

const ReportSlidePage = styled.article`
  position: relative;
  display: grid;
  gap: 1rem;
  padding: 1.1rem;
  min-height: 460px;
  border-radius: 26px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(249, 244, 238, 0.92)),
    var(--panel);
  box-shadow: 0 24px 56px rgba(17, 24, 39, 0.1);
`;

const ReportSlideHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
`;

const ReportSlideEyebrow = styled.div`
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-deep);
`;

const ReportSlideTitle = styled.h3`
  margin: 0.2rem 0 0;
  font-size: clamp(1.1rem, 2vw, 1.45rem);
  line-height: 1.08;
  color: var(--ink);
`;

const ReportSlideCounter = styled.div`
  font-size: 0.78rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--accent-deep) 70%, rgba(31, 41, 55, 0.8));
`;

const ReportSlideHotspot = styled.button<{ $side: "left" | "right" }>`
  position: absolute;
  top: 50%;
  ${({ $side }) => ($side === "left" ? "left: -0.9rem;" : "right: -0.9rem;")}
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 3.5rem;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--accent-deep);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12);
  cursor: pointer;
`;

const ReportSlideHotspotArrow = styled.span`
  font-size: 1.65rem;
  line-height: 1;
`;

const ReportSlideProgress = styled.div`
  display: flex;
  justify-content: center;
  gap: 0.5rem;
`;

const ReportSlideDot = styled.button<{ $active: boolean }>`
  width: ${({ $active }) => ($active ? "1.5rem" : "0.72rem")};
  height: 0.72rem;
  border-radius: 999px;
  border: none;
  background: ${({ $active }) =>
    $active
      ? "color-mix(in srgb, var(--accent) 62%, rgba(31, 41, 55, 0.2))"
      : "rgba(31, 41, 55, 0.18)"};
  cursor: pointer;
`;

const ReportSlideGrid = styled.div<{ $layout: ReportSlideLayout }>`
  display: grid;
  gap: 0.9rem;
  min-height: 0;
  grid-template-columns: ${({ $layout }) => getReportSlideGridTemplate($layout).columns};
  ${({ $layout }) => {
    const { rows } = getReportSlideGridTemplate($layout);
    return rows ? `grid-template-rows: ${rows};` : "";
  }}
`;

const ReportPanelCard = styled.section`
  display: grid;
  gap: 0.75rem;
  min-height: 0;
  padding: 0.95rem;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.82);
`;

const ReportPanelHeader = styled.header`
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;

  strong {
    font-size: 0.92rem;
    line-height: 1.25;
  }

  span {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--accent-deep) 70%, rgba(31, 41, 55, 0.8));
  }
`;

const ReportPanelBody = styled.div`
  min-height: 0;
`;

const ReportMarkdownPanel = styled.div`
  color: var(--ink);
  font-size: 0.84rem;
  line-height: 1.55;

  p,
  ul,
  ol {
    margin: 0 0 0.55rem;
  }

  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }
`;

const ReportPanelImage = styled.img`
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.76);
`;

const ReportPanelPlaceholder = styled.div`
  display: grid;
  place-items: center;
  min-height: 180px;
  padding: 1rem;
  border-radius: 14px;
  border: 1px dashed rgba(31, 41, 55, 0.16);
  color: rgba(31, 41, 55, 0.72);
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
  font-size: 0.8rem;
  line-height: 1.45;
`;

const ReportPanelMeta = styled.div`
  font-size: 0.72rem;
  color: rgba(31, 41, 55, 0.74);
`;
