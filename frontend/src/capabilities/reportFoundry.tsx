import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import { useAppState } from "../app/context";
import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { hasDemoScenarioNotes } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
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
  CapabilityNoteList,
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

type ReportAgentTab = "report" | "demo";

const DEFAULT_STATUS = "Load local files to begin a report-led investigation.";
const DEFAULT_BRIEF =
  "Investigate the attached files, hand off to the right specialist when needed, and build a useful report progressively.";

function isClientChartSpec(value: Record<string, unknown>): value is ClientChartSpec {
  return "type" in value && "title" in value && "label_key" in value && "series" in value;
}

function resolveReportChartRows(
  files: LocalWorkspaceFile[],
  fileId: string | null | undefined,
) {
  if (!fileId) {
    return [];
  }
  const file = files.find((candidate) => candidate.id === fileId);
  return file && (file.kind === "csv" || file.kind === "json") ? file.rows : [];
}

function DemoNotesPanel({
  scenario,
}: {
  scenario: ReturnType<typeof useDemoScenario>["scenario"];
}) {
  if (!hasDemoScenarioNotes(scenario)) {
    return null;
  }

  return (
    <CapabilityPanel data-testid="report-agent-demo-notes">
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Demo notes</CapabilitySectionTitle>
        <CapabilityMetaText>Reference notes for the scripted walkthrough.</CapabilityMetaText>
      </CapabilitySectionHeader>
      {scenario?.expectedOutcomes?.length ? (
        <CapabilityNoteList>
          {scenario.expectedOutcomes.map((outcome, index) => (
            <li key={`expected-${index}`}>{outcome}</li>
          ))}
        </CapabilityNoteList>
      ) : null}
      {scenario?.notes?.length ? (
        <CapabilityNoteList>
          {scenario.notes.map((note, index) => (
            <li key={`note-${index}`}>{note}</li>
          ))}
        </CapabilityNoteList>
      ) : null}
    </CapabilityPanel>
  );
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

  const rows = resolveReportChartRows(files, panel.file_id);
  const chartSpec = isClientChartSpec(panel.chart) ? panel.chart : null;

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
      <CapabilityMetaText>
        Source file: {panel.file_id || "unknown"}.
      </CapabilityMetaText>
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

  useEffect(() => {
    setActiveSlideIndex(0);
  }, [currentReport?.report_id]);

  useEffect(() => {
    if (!slides.length) {
      if (activeSlideIndex !== 0) {
        setActiveSlideIndex(0);
      }
      return;
    }
    if (activeSlideIndex >= slides.length) {
      setActiveSlideIndex(slides.length - 1);
    }
  }, [activeSlideIndex, slides.length]);

  const activeSlide = slides[activeSlideIndex] ?? null;
  const canMoveBackward = activeSlideIndex > 0;
  const canMoveForward = activeSlideIndex < slides.length - 1;

  return (
    <CapabilityPanel data-testid={dataTestIdBase}>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Current report</CapabilitySectionTitle>
        <CapabilityMetaText>
          {currentReport
            ? `${currentReport.title} is in view with ${currentReport.slides.length} slide${
                currentReport.slides.length === 1 ? "" : "s"
              }.`
            : "The active report will appear here as the report agent assembles it."}
        </CapabilityMetaText>
      </CapabilitySectionHeader>

      {currentReport ? (
        <CurrentReportTitle data-testid={`${dataTestIdBase}-title`}>
          {currentReport.title}
        </CurrentReportTitle>
      ) : null}

      {activeSlide ? (
        <CurrentReportCarousel data-testid={`${dataTestIdBase}-carousel`}>
          <CurrentReportCarouselHeader>
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
            <CurrentReportSlideCounter data-testid={`${dataTestIdBase}-slide-counter`}>
              {activeSlideIndex + 1} / {slides.length}
            </CurrentReportSlideCounter>
          </CurrentReportCarouselHeader>
          <CurrentReportSlide
            slide={activeSlide}
            files={files}
            dataTestIdBase={`${dataTestIdBase}-slide-${activeSlideIndex}`}
          />
        </CurrentReportCarousel>
      ) : (
        <CapabilityMetaText data-testid={`${dataTestIdBase}-empty`}>
          {emptyMessage}
        </CapabilityMetaText>
      )}
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
    allowedTabs: ["report", "demo"],
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
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    capabilityId: reportAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildReportAgentDemoScenario,
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

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <DemoNotesPanel scenario={demoScenario} />

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
              showChatKitHeader={false}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </CapabilityPage>
  );
}

const CurrentReportTitle = styled.strong`
  display: block;
  margin-bottom: 0.72rem;
  font-size: 0.95rem;
  line-height: 1.2;
`;

const CurrentReportCarousel = styled.div`
  display: grid;
  gap: 0.78rem;
`;

const CurrentReportCarouselHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
`;

const CurrentReportCarouselControls = styled.div`
  display: inline-flex;
  gap: 0.35rem;
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

const CurrentReportSlideCounter = styled.div`
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const CurrentReportSlideShell = styled.section`
  display: grid;
  gap: 0.72rem;
`;

const CurrentReportSlideHeader = styled.div`
  display: grid;
  gap: 0.18rem;
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

const CurrentReportPanelCardShell = styled.article`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.82rem;
  display: grid;
  gap: 0.58rem;
  min-width: 0;
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
