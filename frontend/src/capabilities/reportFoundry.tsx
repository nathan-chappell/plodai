import { useEffect, useMemo } from "react";
import styled from "styled-components";

import { useAppState } from "../app/context";
import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { hasDemoScenarioNotes } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { NarrativeCard } from "../components/NarrativeCard";
import { WorkspaceArtifactInspector } from "../components/WorkspaceArtifactInspector";
import { reportAgentCapability } from "./definitions";
import { buildReportAgentDemoScenario } from "./report-agent/demo";
import { createReportAgentClientTools } from "./report-agent/tools";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { buildReportAgentBundle } from "./manifests";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { CapabilityClientTool, CapabilityWorkspaceContext, ShellWorkspaceRegistration } from "./types";
import type { ClientEffect, ExecutionMode } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import {
  CapabilityInlineLabel,
  CapabilityInlineToolbar,
  CapabilityPage,
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHeroRow,
  CapabilityMetaText,
  CapabilityNoteList,
  CapabilityPanel,
  CapabilitySegmentButton,
  CapabilitySegmentedControl,
  CapabilitySectionHeader,
  CapabilitySectionTitle,
  CapabilitySubhead,
  CapabilityTabBar,
  CapabilityTabButton,
  CapabilityTextarea,
  CapabilityTitle,
  ReportChatColumn,
  ReportEffectCard,
  ReportEffectsPanel,
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type ReportAgentTab = "report" | "demo";

const DEFAULT_STATUS = "Load local files to begin a report-led investigation.";
const DEFAULT_BRIEF =
  "Investigate the attached files, hand off to the right specialist when needed, and build a useful report progressively.";

function isChartEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "chart_rendered" }> {
  return effect.type === "chart_rendered";
}

function isReportEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "report_section_appended" }> {
  return effect.type === "report_section_appended";
}

function isPdfEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "pdf_smart_split_completed" }> {
  return effect.type === "pdf_smart_split_completed";
}

export function resolveReportDemoWorkspaceMeta(options: {
  loading: boolean;
  error: string | null;
  title: string | null;
}): string {
  if (options.loading) {
    return "Preparing the report demo.";
  }
  if (options.error) {
    return options.error;
  }
  if (options.title) {
    return `Curated scenario loaded: ${options.title}.`;
  }
  return "Preparing scenario.";
}

function InvestigationBriefPanel({
  investigationBrief,
  setInvestigationBrief,
}: {
  investigationBrief: string;
  setInvestigationBrief: (value: string) => void;
}) {
  return (
    <CapabilityPanel>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Analysis goal</CapabilitySectionTitle>
        <CapabilityMetaText>This brief is saved with the conversation so the report agent keeps the objective in view.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Investigate the attached files, produce the strongest charts, and assemble a stakeholder-ready report."
      />
    </CapabilityPanel>
  );
}

export function createReportFoundryClientTools(workspace: CapabilityWorkspaceContext): CapabilityClientTool[] {
  return createReportAgentClientTools(workspace);
}

function ReportSummaryArtifacts({ files }: { files: LocalWorkspaceFile[] }) {
  return (
    <CapabilityPanel>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Workspace artifacts</CapabilitySectionTitle>
        <CapabilityMetaText>
          Click an artifact to inspect it.
        </CapabilityMetaText>
      </CapabilitySectionHeader>
      <WorkspaceArtifactInspector
        files={[...files].reverse()}
        compact
        emptyMessage="No workspace artifacts yet. As the report agent and its delegates create files, they will appear here."
      />
    </CapabilityPanel>
  );
}

function DemoRunModePanel({
  executionMode,
  onExecutionModeChange,
}: {
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
}) {
  return (
    <CapabilityPanel>
      <CapabilityInlineToolbar>
        <CapabilityInlineLabel>Run mode</CapabilityInlineLabel>
        <CapabilitySegmentedControl>
          {(["interactive", "batch"] as const).map((mode) => (
            <CapabilitySegmentButton
              key={mode}
              $active={executionMode === mode}
              data-testid={`report-agent-demo-execution-mode-${mode}`}
              onClick={() => onExecutionModeChange(mode)}
              type="button"
            >
              {mode === "interactive" ? "Interactive" : "Batch"}
            </CapabilitySegmentButton>
          ))}
        </CapabilitySegmentedControl>
      </CapabilityInlineToolbar>
      <CapabilityMetaText>
        Interactive mode can pause for confirmation. Batch mode continues with the strongest reasonable next step.
      </CapabilityMetaText>
    </CapabilityPanel>
  );
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
    cwdPath,
    breadcrumbs,
    entries,
    files,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    executionMode,
    setExecutionMode,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
    setFiles,
    createDirectory,
    changeDirectory,
    workspaceContext,
    workspaceHydrated,
    getState,
    updateFilesystem,
    syncToolCatalog,
    appendReportEffects,
    reportIds,
    workspaceBootstrapMetadata,
  } = useCapabilityFileWorkspace({
    capabilityId: reportAgentCapability.id,
    capabilityTitle: reportAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "report",
    allowedTabs: ["report", "demo"],
  });
  const capabilityBundle = useMemo(() => buildReportAgentBundle(reportIds), [reportIds]);
  const clientTools = useMemo<CapabilityClientTool[]>(
    () => createReportFoundryClientTools({ cwdPath, entries, files, workspaceContext, createDirectory, changeDirectory, updateFilesystem, getState }),
    [changeDirectory, createDirectory, cwdPath, entries, files, getState, updateFilesystem, workspaceContext],
  );
  const clientToolCatalogKey = useMemo(() => clientTools.map((tool) => tool.name).join("|"), [clientTools]);
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
  const demoSeedIds = useMemo(() => new Set((demoScenario?.workspaceSeed ?? []).map((file) => file.id)), [demoScenario]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: reportAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      cwdPath,
      breadcrumbs,
      entries,
      accept: ".csv,.json,.pdf",
      onSelectFiles: handleFiles,
      onCreateDirectory: createDirectory,
      onChangeDirectory: changeDirectory,
      onRemoveEntry: handleRemoveEntry,
    });
  }, [breadcrumbs, changeDirectory, createDirectory, cwdPath, entries, handleFiles, handleRemoveEntry, onRegisterWorkspace]);

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
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Report canvas</CapabilitySectionTitle>
                <CapabilityMetaText>{status}</CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "none yet"}</MetaText>
              <MetaText>CWD: {cwdPath}</MetaText>
              <MetaText>
                Current goal: {investigationBrief.trim() || "No goal set yet."}
              </MetaText>
              <MetaText>Use the sidebar workspace panel to add, inspect, or remove the files feeding this report.</MetaText>
            </CapabilityPanel>

            {reportEffects.length ? (
              <ReportEffectsPanel>
                {reportEffects.map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${index}`}>
                    {isChartEffect(effect) ? <DatasetChart spec={effect.chart} rows={effect.rows} /> : null}
                    {isReportEffect(effect) ? (
                      <NarrativeCard
                        section={{
                          id: `${effect.type}-${index}`,
                          title: effect.title,
                          markdown: effect.markdown,
                        }}
                      />
                    ) : null}
                    {isPdfEffect(effect) ? (
                      <>
                        <h3>Smart split: {effect.sourceFileName}</h3>
                        <MetaText>{effect.markdown}</MetaText>
                        <MetaText>Archive: {effect.archiveFileName}</MetaText>
                      </>
                    ) : null}
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}

            <ReportSummaryArtifacts files={files} />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceContext={workspaceContext}
              workspaceBootstrap={workspaceBootstrapMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel data-testid="report-agent-demo-workspace">
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {resolveReportDemoWorkspaceMeta({
                    loading: demoLoading,
                    error: demoError,
                    title: demoScenario?.title ?? null,
                  })}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <CompactSummaryGrid>
                <CompactSummaryItem data-testid="report-agent-demo-title">
                  <strong>{demoScenario?.title ?? "Preparing scenario"}</strong>
                  <MetaText>{files.length} workspace file{files.length === 1 ? "" : "s"}</MetaText>
                </CompactSummaryItem>
                <CompactSummaryItem data-testid="report-agent-demo-derived-artifacts">
                  <strong>{files.filter((file) => !demoSeedIds.has(file.id)).length}</strong>
                  <MetaText>derived artifacts</MetaText>
                </CompactSummaryItem>
                <CompactSummaryItem data-testid="report-agent-demo-visible-effects">
                  <strong>{reportEffects.length}</strong>
                  <MetaText>visible effects</MetaText>
                </CompactSummaryItem>
              </CompactSummaryGrid>
            </CapabilityPanel>

            <DemoRunModePanel executionMode={executionMode} onExecutionModeChange={setExecutionMode} />

            <DemoNotesPanel scenario={demoScenario} />

            {reportEffects.length ? (
              <ReportEffectsPanel data-testid="report-agent-demo-effects">
                {reportEffects.map((effect, index) => (
                  <ReportEffectCard
                    key={`${effect.type}-${index}`}
                    data-testid={
                      isReportEffect(effect)
                        ? "report-agent-demo-report-effect"
                        : isChartEffect(effect)
                          ? "report-agent-demo-chart-effect"
                          : isPdfEffect(effect)
                            ? "report-agent-demo-pdf-effect"
                            : undefined
                    }
                  >
                    {isChartEffect(effect) ? <DatasetChart spec={effect.chart} rows={effect.rows} /> : null}
                    {isReportEffect(effect) ? (
                      <NarrativeCard
                        section={{
                          id: `${effect.type}-${index}`,
                          title: effect.title,
                          markdown: effect.markdown,
                        }}
                      />
                    ) : null}
                    {isPdfEffect(effect) ? (
                      <>
                        <h3>Smart split: {effect.sourceFileName}</h3>
                        <MetaText>{effect.markdown}</MetaText>
                        <MetaText>Archive: {effect.archiveFileName}</MetaText>
                      </>
                    ) : null}
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}

            <div data-testid="report-agent-demo-artifacts">
              <ReportSummaryArtifacts files={files} />
            </div>
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              workspaceBootstrap={workspaceBootstrapMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              showScenarioNotes={false}
              showExecutionModeControls={false}
              feedbackButtonVariant="icon"
              showChatKitHeader={false}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </CapabilityPage>
  );
}

const CompactSummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const CompactSummaryItem = styled.div`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.56);
  padding: 0.7rem 0.78rem;
`;
