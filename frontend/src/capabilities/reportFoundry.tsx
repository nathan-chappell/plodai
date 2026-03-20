import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import { useAppState } from "../app/context";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { openWorkspaceFileInNewTab } from "../lib/workspace-artifacts";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./registry";
import { reportAgentCapability } from "./definitions";
import { buildReportAgentDemoScenario } from "./report-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { ShellWorkspaceRegistration } from "./types";
import type { ClientChartSpec } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  ReportSlideLayout,
  ReportSlidePanelV1,
  ReportSlideV1,
  WorkspaceReportV1,
} from "../types/workspace-contract";
import {
  CapabilityPage,
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHeroRow,
  CapabilityMetaText,
  CapabilityPanel,
  CapabilitySectionHeader,
  CapabilitySectionTitle,
  CapabilitySubhead,
  CapabilityTabBar,
  CapabilityTabButton,
  CapabilityTitle,
  ReportChatColumn,
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type ReportAgentTab = "report" | "reports" | "demo";

const DEFAULT_STATUS = "Load local files to begin a report-led investigation.";
const DEFAULT_BRIEF =
  "Investigate the attached files, hand off to the right specialist when needed, and build a useful report progressively.";

function isClientChartSpec(value: Record<string, unknown>): value is ClientChartSpec {
  return "type" in value && "title" in value && "label_key" in value && "series" in value;
}

function resolveReportChartRows(
  files: LocalWorkspaceFile[],
  panel: Extract<ReportSlidePanelV1, { type: "chart" }>,
) {
  const file = resolveReportChartSourceFile(files, panel);
  return file && (file.kind === "csv" || file.kind === "json") ? file.rows : [];
}

function readChartSourceFileId(file: LocalWorkspaceFile | null): string | null {
  if (file?.kind !== "other" || !file.text_content) {
    return null;
  }
  try {
    const parsed = JSON.parse(file.text_content) as {
      file_id?: unknown;
    };
    return typeof parsed.file_id === "string" ? parsed.file_id : null;
  } catch {
    return null;
  }
}

function resolveReportChartSourceFile(
  files: LocalWorkspaceFile[],
  panel: Extract<ReportSlidePanelV1, { type: "chart" }>,
): LocalWorkspaceFile | null {
  const directMatch = files.find((candidate) => candidate.id === panel.file_id) ?? null;
  if (directMatch && (directMatch.kind === "csv" || directMatch.kind === "json")) {
    return directMatch;
  }

  const sourceFileIdFromDirectMatch = readChartSourceFileId(directMatch);
  if (sourceFileIdFromDirectMatch) {
    const sourceFromDirectMatch =
      files.find((candidate) => candidate.id === sourceFileIdFromDirectMatch) ?? null;
    if (sourceFromDirectMatch) {
      return sourceFromDirectMatch;
    }
  }

  const chartArtifactMatch =
    files.find((candidate) => {
      if (candidate.kind !== "other" || !candidate.text_content) {
        return false;
      }
      try {
        const parsed = JSON.parse(candidate.text_content) as {
          chart_plan_id?: unknown;
          file_id?: unknown;
        };
        return (
          parsed &&
          typeof parsed.chart_plan_id === "string" &&
          parsed.chart_plan_id === panel.chart_plan_id &&
          typeof parsed.file_id === "string"
        );
      } catch {
        return false;
      }
    }) ?? null;

  const sourceFileIdFromArtifact = readChartSourceFileId(chartArtifactMatch);
  if (sourceFileIdFromArtifact) {
    const sourceFromArtifact =
      files.find((candidate) => candidate.id === sourceFileIdFromArtifact) ?? null;
    if (sourceFromArtifact) {
      return sourceFromArtifact;
    }
  }

  return directMatch;
}

function formatReportTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CurrentReportPanelCard({
  panel,
  files,
  dataTestIdBase,
}: {
  panel: ReportSlidePanelV1;
  files: LocalWorkspaceFile[];
  dataTestIdBase: string;
}) {
  if (panel.type === "narrative") {
    return (
      <CurrentReportPanelCardShell data-testid={`${dataTestIdBase}-narrative`}>
        <CurrentReportPanelHeading>{panel.title}</CurrentReportPanelHeading>
        <CurrentReportMarkdown>
          <ReactMarkdown>{panel.markdown}</ReactMarkdown>
        </CurrentReportMarkdown>
      </CurrentReportPanelCardShell>
    );
  }

  const rows = resolveReportChartRows(files, panel);
  const chartSpec = isClientChartSpec(panel.chart) ? panel.chart : null;
  const sourceFile = resolveReportChartSourceFile(files, panel);

  return (
    <CurrentReportPanelCardShell data-testid={`${dataTestIdBase}-chart`}>
      <CurrentReportPanelHeading>{panel.title}</CurrentReportPanelHeading>
      {panel.image_data_url ? (
        <CurrentReportChartImage
          alt={panel.title}
          data-testid={`${dataTestIdBase}-chart-image`}
          src={panel.image_data_url}
        />
      ) : chartSpec && rows.length ? (
        <DatasetChart spec={chartSpec} rows={rows} />
      ) : (
        <CapabilityMetaText>
          This chart is saved in the current report, but its preview is not available yet.
        </CapabilityMetaText>
      )}
      <CurrentReportSourceRow>
        <CapabilityMetaText>
          Source file: {sourceFile?.name ?? panel.file_id ?? "unknown"}.
        </CapabilityMetaText>
        {sourceFile ? (
          <CurrentReportInlineLink
            data-testid={`${dataTestIdBase}-open-source`}
            onClick={() => openWorkspaceFileInNewTab(sourceFile)}
            type="button"
          >
            Open source
          </CurrentReportInlineLink>
        ) : null}
      </CurrentReportSourceRow>
    </CurrentReportPanelCardShell>
  );
}

function panelGridColumns(layout: ReportSlideLayout): string {
  if (layout === "1x1") {
    return "minmax(0, 1fr)";
  }
  return "repeat(2, minmax(0, 1fr))";
}

function CurrentReportSlide({
  slide,
  files,
  dataTestIdBase,
}: {
  slide: ReportSlideV1;
  files: LocalWorkspaceFile[];
  dataTestIdBase: string;
}) {
  return (
    <CurrentReportSlideShell data-testid={`${dataTestIdBase}-slide`}>
      <CurrentReportSlideHeader>
        <CurrentReportSlideTitle data-testid={`${dataTestIdBase}-slide-title`}>
          {slide.title}
        </CurrentReportSlideTitle>
        <CurrentReportSlideMeta>{slide.layout.toUpperCase()} layout</CurrentReportSlideMeta>
      </CurrentReportSlideHeader>
      <CurrentReportSlideGrid
        $columns={panelGridColumns(slide.layout)}
        data-testid={`${dataTestIdBase}-slide-panels`}
      >
        {slide.panels.map((panel, index) => (
          <CurrentReportPanelCard
            key={panel.id}
            panel={panel}
            files={files}
            dataTestIdBase={`${dataTestIdBase}-panel-${index}`}
          />
        ))}
      </CurrentReportSlideGrid>
    </CurrentReportSlideShell>
  );
}

export function CurrentReportPanel({
  currentReport,
  files,
  emptyMessage,
  dataTestIdBase,
}: {
  currentReport: WorkspaceReportV1 | null;
  files: LocalWorkspaceFile[];
  emptyMessage: string;
  dataTestIdBase: string;
}) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const slides = currentReport?.slides ?? [];
  const previousReportIdRef = useRef<string | null>(currentReport?.report_id ?? null);
  const previousSlideCountRef = useRef(slides.length);

  useEffect(() => {
    if (previousReportIdRef.current === (currentReport?.report_id ?? null)) {
      return;
    }
    previousReportIdRef.current = currentReport?.report_id ?? null;
    previousSlideCountRef.current = slides.length;
    setActiveSlideIndex(0);
  }, [currentReport?.report_id, slides.length]);

  useEffect(() => {
    const previousSlideCount = previousSlideCountRef.current;
    if (!slides.length) {
      if (activeSlideIndex !== 0) {
        setActiveSlideIndex(0);
      }
      previousSlideCountRef.current = 0;
      return;
    }
    if (activeSlideIndex >= slides.length) {
      setActiveSlideIndex(slides.length - 1);
      previousSlideCountRef.current = slides.length;
      return;
    }
    if (
      slides.length > previousSlideCount &&
      previousSlideCount > 0 &&
      activeSlideIndex === previousSlideCount - 1
    ) {
      setActiveSlideIndex(slides.length - 1);
    }
    previousSlideCountRef.current = slides.length;
  }, [activeSlideIndex, slides.length]);

  const activeSlide = slides[activeSlideIndex] ?? null;
  const canMoveBackward = activeSlideIndex > 0;
  const canMoveForward = activeSlideIndex < slides.length - 1;
  const updatedLabel = formatReportTimestamp(currentReport?.updated_at);
  const activeSlideLabel = activeSlide ? `${activeSlideIndex + 1} / ${slides.length}` : "No slide";

  return (
    <CurrentReportPanelShell data-testid={dataTestIdBase}>
      <CurrentReportHeaderRow>
        <CapabilitySectionTitle>Current report</CapabilitySectionTitle>
      </CurrentReportHeaderRow>

      <CurrentReportInfoGrid>
        <CurrentReportInfoCard>
          <CurrentReportInfoLabel>Report</CurrentReportInfoLabel>
          <CurrentReportInfoValue data-testid={`${dataTestIdBase}-title`}>
            {currentReport?.title ?? "No active report"}
          </CurrentReportInfoValue>
          <CurrentReportInfoSubvalue>
            {currentReport?.report_id ?? "The report agent will create or reuse one here."}
          </CurrentReportInfoSubvalue>
        </CurrentReportInfoCard>
        <CurrentReportInfoCard>
          <CurrentReportInfoLabel>Updated</CurrentReportInfoLabel>
          <CurrentReportInfoValue>{updatedLabel ?? "Not yet saved"}</CurrentReportInfoValue>
          <CurrentReportInfoSubvalue>
            Workspace-backed report state
          </CurrentReportInfoSubvalue>
        </CurrentReportInfoCard>
        <CurrentReportInfoCard>
          <CurrentReportInfoLabel>Slides</CurrentReportInfoLabel>
          <CurrentReportInfoValue>
            {currentReport?.slides.length ?? 0}
          </CurrentReportInfoValue>
          <CurrentReportInfoSubvalue>
            {currentReport
              ? `${currentReport.slides.length === 1 ? "Saved slide" : "Saved slides"}`
              : "No saved slides yet"}
          </CurrentReportInfoSubvalue>
        </CurrentReportInfoCard>
        <CurrentReportInfoCard>
          <CurrentReportInfoLabel>In view</CurrentReportInfoLabel>
          <CurrentReportInfoValue data-testid={`${dataTestIdBase}-slide-counter`}>
            {activeSlideLabel}
          </CurrentReportInfoValue>
          <CurrentReportInfoSubvalue>
            {activeSlide ? activeSlide.layout.toUpperCase() : "Waiting for the first report update"}
          </CurrentReportInfoSubvalue>
        </CurrentReportInfoCard>
      </CurrentReportInfoGrid>

      {activeSlide ? (
        <CurrentReportFrame data-testid={`${dataTestIdBase}-carousel`}>
          <CurrentReportSurface>
            <CurrentReportSlide
              slide={activeSlide}
              files={files}
              dataTestIdBase={`${dataTestIdBase}-slide-${activeSlideIndex}`}
            />
          </CurrentReportSurface>
          <CurrentReportCarouselFooter>
            <CurrentReportCarouselControls>
              <CurrentReportNavButton
                data-testid={`${dataTestIdBase}-previous-slide`}
                disabled={!canMoveBackward}
                onClick={() => setActiveSlideIndex((index) => Math.max(index - 1, 0))}
                type="button"
              >
                Previous
              </CurrentReportNavButton>
              <CurrentReportNavButton
                data-testid={`${dataTestIdBase}-next-slide`}
                disabled={!canMoveForward}
                onClick={() => setActiveSlideIndex((index) => Math.min(index + 1, slides.length - 1))}
                type="button"
              >
                Next
              </CurrentReportNavButton>
            </CurrentReportCarouselControls>
          </CurrentReportCarouselFooter>
        </CurrentReportFrame>
      ) : (
        <CurrentReportSurface $empty data-testid={`${dataTestIdBase}-empty`}>
          <CurrentReportEmptyTitle>No saved slide yet</CurrentReportEmptyTitle>
          <CurrentReportEmptyMeta>{emptyMessage}</CurrentReportEmptyMeta>
        </CurrentReportSurface>
      )}
    </CurrentReportPanelShell>
  );
}

type ReportBrowserSelection = {
  reportId: string;
  slideId: string | null;
};

function sortReportsForBrowser(
  reports: WorkspaceReportV1[],
  currentReportId: string | null,
): WorkspaceReportV1[] {
  return [...reports].sort((left, right) => {
    if (left.report_id === currentReportId) {
      return -1;
    }
    if (right.report_id === currentReportId) {
      return 1;
    }
    const leftUpdated = Date.parse(left.updated_at ?? left.created_at);
    const rightUpdated = Date.parse(right.updated_at ?? right.created_at);
    if (!Number.isNaN(leftUpdated) && !Number.isNaN(rightUpdated) && leftUpdated !== rightUpdated) {
      return rightUpdated - leftUpdated;
    }
    return left.title.localeCompare(right.title);
  });
}

function ReportBrowserPanel({
  reports,
  currentReportId,
  files,
  onSelectCurrentReport,
  dataTestIdBase,
}: {
  reports: WorkspaceReportV1[];
  currentReportId: string | null;
  files: LocalWorkspaceFile[];
  onSelectCurrentReport: (reportId: string) => void;
  dataTestIdBase: string;
}) {
  const sortedReports = useMemo(
    () => sortReportsForBrowser(reports, currentReportId),
    [currentReportId, reports],
  );
  const [selection, setSelection] = useState<ReportBrowserSelection | null>(null);

  useEffect(() => {
    if (!sortedReports.length) {
      if (selection !== null) {
        setSelection(null);
      }
      return;
    }
    const fallbackReportId =
      (currentReportId && sortedReports.some((report) => report.report_id === currentReportId)
        ? currentReportId
        : sortedReports[0]?.report_id) ?? null;
    if (!fallbackReportId) {
      return;
    }
    if (!selection) {
      setSelection({ reportId: fallbackReportId, slideId: null });
      return;
    }
    const selectedReport = sortedReports.find((report) => report.report_id === selection.reportId);
    if (!selectedReport) {
      setSelection({ reportId: fallbackReportId, slideId: null });
      return;
    }
    if (selection.slideId && !selectedReport.slides.some((slide) => slide.id === selection.slideId)) {
      setSelection({ reportId: selectedReport.report_id, slideId: null });
    }
  }, [currentReportId, selection, sortedReports]);

  const selectedReport = useMemo(
    () =>
      selection
        ? sortedReports.find((report) => report.report_id === selection.reportId) ?? null
        : null,
    [selection, sortedReports],
  );
  const previewSlide = useMemo(() => {
    if (!selectedReport) {
      return null;
    }
    if (selection?.slideId) {
      return selectedReport.slides.find((slide) => slide.id === selection.slideId) ?? null;
    }
    return selectedReport.slides[0] ?? null;
  }, [selectedReport, selection?.slideId]);

  return (
    <CapabilityPanel data-testid={dataTestIdBase}>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Reports</CapabilitySectionTitle>
        <CapabilityMetaText>
          Browse saved workspace reports, inspect their slides, and choose which report stays active.
        </CapabilityMetaText>
      </CapabilitySectionHeader>
      <ReportBrowserLayout>
        <ReportBrowserTree data-testid={`${dataTestIdBase}-tree`}>
          {sortedReports.length ? (
            sortedReports.map((report) => {
              const reportSelected =
                selection?.reportId === report.report_id && selection.slideId === null;
              const reportUpdatedLabel = formatReportTimestamp(report.updated_at ?? report.created_at);
              return (
                <ReportBrowserGroup key={report.report_id}>
                  <ReportBrowserRow
                    data-current={String(currentReportId === report.report_id)}
                    data-selected={String(reportSelected)}
                    data-testid={`${dataTestIdBase}-report-${report.report_id}`}
                    onClick={() => {
                      setSelection({ reportId: report.report_id, slideId: null });
                      onSelectCurrentReport(report.report_id);
                    }}
                    type="button"
                  >
                    <ReportBrowserRowMain>
                      <ReportBrowserRowTitle>{report.title}</ReportBrowserRowTitle>
                      <ReportBrowserRowMeta>
                        <span>{report.slides.length} slide{report.slides.length === 1 ? "" : "s"}</span>
                        {reportUpdatedLabel ? <span>{reportUpdatedLabel}</span> : null}
                      </ReportBrowserRowMeta>
                    </ReportBrowserRowMain>
                    {currentReportId === report.report_id ? (
                      <ReportBrowserCurrentBadge>Current</ReportBrowserCurrentBadge>
                    ) : null}
                  </ReportBrowserRow>
                  {report.slides.length ? (
                    <ReportBrowserSlideList>
                      {report.slides.map((slide, slideIndex) => {
                        const slideSelected =
                          selection?.reportId === report.report_id &&
                          selection.slideId === slide.id;
                        return (
                          <ReportBrowserSlideRow
                            key={slide.id}
                            data-selected={String(slideSelected)}
                            data-testid={`${dataTestIdBase}-slide-${report.report_id}-${slide.id}`}
                            onClick={() => {
                              setSelection({ reportId: report.report_id, slideId: slide.id });
                              onSelectCurrentReport(report.report_id);
                            }}
                            type="button"
                          >
                            <span>{slideIndex + 1}.</span>
                            <span>{slide.title}</span>
                          </ReportBrowserSlideRow>
                        );
                      })}
                    </ReportBrowserSlideList>
                  ) : (
                    <ReportBrowserEmptyGroup>No slides yet.</ReportBrowserEmptyGroup>
                  )}
                </ReportBrowserGroup>
              );
            })
          ) : (
            <ReportBrowserEmptyState>
              Saved reports will appear here as soon as the report agent creates them.
            </ReportBrowserEmptyState>
          )}
        </ReportBrowserTree>
        <ReportBrowserPreview data-testid={`${dataTestIdBase}-preview`}>
          {selectedReport ? (
            <>
              <ReportBrowserPreviewHeader>
                <div>
                  <ReportBrowserPreviewTitle data-testid={`${dataTestIdBase}-preview-title`}>
                    {selectedReport.title}
                  </ReportBrowserPreviewTitle>
                  <ReportBrowserPreviewMeta>
                    <span>{selectedReport.report_id}</span>
                    <span>{selectedReport.slides.length} slide{selectedReport.slides.length === 1 ? "" : "s"}</span>
                    {formatReportTimestamp(selectedReport.updated_at ?? selectedReport.created_at) ? (
                      <span>
                        Updated {formatReportTimestamp(selectedReport.updated_at ?? selectedReport.created_at)}
                      </span>
                    ) : null}
                  </ReportBrowserPreviewMeta>
                </div>
                {currentReportId === selectedReport.report_id ? (
                  <ReportBrowserCurrentBadge>Active report</ReportBrowserCurrentBadge>
                ) : null}
              </ReportBrowserPreviewHeader>
              {previewSlide ? (
                <CurrentReportSlide
                  slide={previewSlide}
                  files={files}
                  dataTestIdBase={`${dataTestIdBase}-preview-slide`}
                />
              ) : (
                <ReportBrowserEmptyState>
                  This report exists in the workspace, but it does not have any saved slides yet.
                </ReportBrowserEmptyState>
              )}
            </>
          ) : (
            <ReportBrowserEmptyState>
              Select a report to inspect its saved slide preview.
            </ReportBrowserEmptyState>
          )}
        </ReportBrowserPreview>
      </ReportBrowserLayout>
    </CapabilityPanel>
  );
}

export function ReportFoundryPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const { user } = useAppState();
  if (!user) {
    return null;
  }

  const {
    activePrefix,
    cwdPath,
    entries,
    files,
    appendFiles,
    artifacts,
    setStatus,
    investigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    executionMode,
    setExecutionMode,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
    setFiles,
    createDirectory,
    changeDirectory,
    setActivePrefix,
    workspaceContext,
    workspaceHydrated,
    getState,
    updateFilesystem,
    syncToolCatalog,
    appendReportEffects,
    reports,
    selectCurrentReport,
    currentReport,
    workspaceStateMetadata,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspaceName,
    selectedWorkspaceKind,
    selectWorkspace,
    createWorkspace,
    clearWorkspace,
  } = useCapabilityFileWorkspace({
    capabilityId: reportAgentCapability.id,
    capabilityTitle: reportAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "report",
    allowedTabs: ["report", "reports", "demo"],
  });
  const capabilityWorkspace = useMemo(
    () => ({
      activePrefix,
      cwdPath,
      entries,
      files,
      workspaceContext,
      setActivePrefix,
      createDirectory,
      changeDirectory,
      updateFilesystem,
      getState,
    }),
    [activePrefix, changeDirectory, createDirectory, cwdPath, entries, files, getState, setActivePrefix, updateFilesystem, workspaceContext],
  );
  const capabilityBundle = useMemo(
    () => buildCapabilityBundleForRoot(reportAgentCapability.id, capabilityWorkspace),
    [capabilityWorkspace],
  );
  const clientTools = useMemo(
    () => bindClientToolsForBundle(capabilityBundle, capabilityWorkspace),
    [capabilityBundle, capabilityWorkspace],
  );
  const clientToolCatalogKey = useMemo(
    () => listCapabilityBundleToolNames(capabilityBundle).join("|"),
    [capabilityBundle],
  );
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
    prepareDemoRun,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    capabilityId: reportAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildReportAgentDemoScenario,
    files,
    setExecutionMode,
    setFiles,
    setStatus,
    setReportEffects,
  });

  const handleClearWorkspace = useMemo(() => {
    if (selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo") {
      return () => {
        if (!demoScenario) {
          return;
        }
        setFiles(demoScenario.workspaceSeed);
        setReportEffects([]);
        setStatus(`Reset demo workspace for ${demoScenario.title}.`);
      };
    }
    return clearWorkspace;
  }, [activeWorkspaceTab, clearWorkspace, demoScenario, selectedWorkspaceKind, setFiles, setReportEffects, setStatus]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: reportAgentCapability.id,
      title: "Workspace",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
      workspaces,
      activeWorkspaceId: selectedWorkspaceId,
      activeWorkspaceName: selectedWorkspaceName,
      activeWorkspaceKind: selectedWorkspaceKind,
      accept: ".csv,.json,.pdf",
      onSelectFiles: handleFiles,
      onSelectWorkspace: selectWorkspace,
      onCreateWorkspace: createWorkspace,
      onClearWorkspace: handleClearWorkspace,
      clearActionLabel:
        selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo"
          ? "Reset demo workspace"
          : "Clear workspace",
      clearActionDisabled:
        selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo" && !demoScenario,
      onRemoveArtifact: handleRemoveEntry,
    });
  }, [
    activeWorkspaceTab,
    artifacts,
    createWorkspace,
    demoScenario,
    handleClearWorkspace,
    handleFiles,
    handleRemoveEntry,
    onRegisterWorkspace,
    selectWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceKind,
    selectedWorkspaceName,
    workspaces,
  ]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  return (
    <CapabilityPage>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{reportAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{reportAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Lead an investigation, hand off to specialists when needed, and assemble a narrative report over local files.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {reportAgentCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
            data-testid={`report-agent-tab-${tab.id}`}
            $active={activeWorkspaceTab === tab.id}
            onClick={() => setActiveWorkspaceTab(tab.id as ReportAgentTab)}
            type="button"
          >
            {tab.label}
          </CapabilityTabButton>
        ))}
      </CapabilityTabBar>

      {activeWorkspaceTab === "report" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CurrentReportPanel
              currentReport={currentReport}
              files={files}
              emptyMessage="The active report has no slides yet. As the agent works, saved report slides will appear here."
              dataTestIdBase="report-agent-current-report"
            />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceState={workspaceStateMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              greeting={reportAgentCapability.chatkitLead}
              composerPlaceholder={reportAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "reports" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <ReportBrowserPanel
              reports={reports}
              currentReportId={currentReport?.report_id ?? null}
              files={files}
              onSelectCurrentReport={selectCurrentReport}
              dataTestIdBase="report-agent-reports-browser"
            />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceState={workspaceStateMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              greeting={reportAgentCapability.chatkitLead}
              composerPlaceholder={reportAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CurrentReportPanel
              currentReport={currentReport}
              files={files}
              emptyMessage="Run the demo to populate the current report with narrative updates and chart output."
              dataTestIdBase="report-agent-demo-current-report"
            />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              workspaceState={workspaceStateMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              onPrepareDemoRun={prepareDemoRun}
              showChatKitHeader={false}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </CapabilityPage>
  );
}

const CurrentReportHeaderRow = styled(CapabilitySectionHeader)`
  gap: 0.1rem;
`;

const CurrentReportPanelShell = styled(CapabilityPanel)`
  min-height: 100%;
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
  align-content: stretch;
`;

const CurrentReportCarouselControls = styled.div`
  display: inline-flex;
  gap: 0.35rem;
`;

const CurrentReportFrame = styled.div`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 0.52rem;
`;

const CurrentReportCarouselFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.55rem;
  padding-top: 0.12rem;
`;

const CurrentReportNavButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: var(--ink);
  padding: 0.34rem 0.68rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const CurrentReportSlideShell = styled.section`
  display: grid;
  gap: 0.72rem;
`;

const CurrentReportSlideHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem 0.55rem;
`;

const CurrentReportSlideTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
`;

const CurrentReportSlideMeta = styled.div`
  color: var(--muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const CurrentReportSlideGrid = styled.div<{ $columns: string }>`
  display: grid;
  gap: 0.72rem;
  grid-template-columns: ${({ $columns }) => $columns};

  @media (max-width: 820px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const CurrentReportInfoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem;
  margin-bottom: 0.68rem;

  @media (max-width: 920px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const CurrentReportInfoCard = styled.div`
  min-width: 0;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.52rem 0.62rem;
  display: grid;
  gap: 0.1rem;
`;

const CurrentReportInfoLabel = styled.div`
  color: var(--muted);
  font-size: 0.67rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const CurrentReportInfoValue = styled.div`
  color: var(--ink);
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.18;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const CurrentReportInfoSubvalue = styled.div`
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.25;
`;

const CurrentReportSurface = styled.div<{ $empty?: boolean }>`
  min-height: 0;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.82rem;
  display: grid;
  height: 100%;
  align-content: start;
  gap: 0.72rem;
  ${({ $empty }) =>
    $empty
      ? ""
      : `
    overflow: auto;
  `}
`;

const CurrentReportEmptyTitle = styled.strong`
  color: var(--ink);
  font-size: 0.88rem;
  line-height: 1.2;
`;

const CurrentReportEmptyMeta = styled.div`
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.42;
  max-width: 52ch;
`;

const CurrentReportPanelCardShell = styled.article`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.82rem;
  display: grid;
  gap: 0.58rem;
  min-width: 0;
`;

const CurrentReportSourceRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.7rem;
`;

const CurrentReportInlineLink = styled.button`
  border: 0;
  background: none;
  color: var(--accent-deep);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 0;
  cursor: pointer;
`;

const CurrentReportPanelHeading = styled.h4`
  margin: 0;
  font-size: 0.88rem;
`;

const CurrentReportMarkdown = styled.div`
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.42;

  p,
  ul,
  ol {
    margin: 0;
  }

  p + p,
  p + ul,
  p + ol,
  ul + p,
  ol + p,
  ul + ul,
  ol + ol {
    margin-top: 0.48rem;
  }

  h1,
  h2,
  h3,
  h4 {
    margin: 0 0 0.38rem;
    color: var(--ink);
    font-size: 0.86rem;
    line-height: 1.18;
  }

  ul,
  ol {
    padding-left: 1rem;
  }

  code {
    font-size: 0.78rem;
  }
`;

const CurrentReportChartImage = styled.img`
  width: 100%;
  display: block;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.88);
`;

const ReportBrowserLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 0.72rem;
  min-height: 0;

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const ReportBrowserTree = styled.div`
  display: grid;
  gap: 0.5rem;
  min-height: 0;
  max-height: min(70vh, 760px);
  overflow: auto;
  padding-right: 0.08rem;
`;

const ReportBrowserGroup = styled.div`
  display: grid;
  gap: 0.22rem;
`;

const ReportBrowserRow = styled.button`
  width: 100%;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.78);
  padding: 0.58rem 0.68rem;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
  text-align: left;
  cursor: pointer;

  &[data-selected="true"] {
    border-color: rgba(201, 111, 59, 0.28);
    background: rgba(248, 238, 228, 0.96);
  }
`;

const ReportBrowserRowMain = styled.span`
  display: grid;
  gap: 0.12rem;
  min-width: 0;
`;

const ReportBrowserRowTitle = styled.span`
  color: var(--ink);
  font-size: 0.84rem;
  font-weight: 700;
  line-height: 1.18;
`;

const ReportBrowserRowMeta = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.2;
`;

const ReportBrowserCurrentBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.42rem;
  background: rgba(201, 111, 59, 0.12);
  color: var(--accent-deep);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const ReportBrowserSlideList = styled.div`
  display: grid;
  gap: 0.14rem;
  padding-left: 0.6rem;
`;

const ReportBrowserSlideRow = styled.button`
  width: 100%;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  padding: 0.26rem 0.34rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.4rem;
  text-align: left;
  cursor: pointer;

  &[data-selected="true"] {
    background: rgba(255, 255, 255, 0.78);
    color: var(--ink);
  }
`;

const ReportBrowserEmptyGroup = styled.div`
  padding-left: 0.94rem;
  color: var(--muted);
  font-size: 0.74rem;
`;

const ReportBrowserPreview = styled.section`
  min-height: 0;
  max-height: min(70vh, 760px);
  overflow: auto;
  padding-right: 0.08rem;
  display: grid;
  align-content: start;
  gap: 0.72rem;
`;

const ReportBrowserPreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const ReportBrowserPreviewTitle = styled.h4`
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.16;
`;

const ReportBrowserPreviewMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.25;
  margin-top: 0.16rem;
`;

const ReportBrowserEmptyState = styled.div`
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
`;
