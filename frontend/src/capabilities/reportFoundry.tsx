import { useEffect, useMemo } from "react";

import { useAppState } from "../app/context";
import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { NarrativeCard } from "../components/NarrativeCard";
import { buildReportAgentDemoScenario } from "./report-agent/demo";
import { createReportAgentClientTools } from "./report-agent/tools";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { buildReportAgentBundle } from "./manifests";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { CapabilityClientTool, CapabilityDefinition, ShellWorkspaceRegistration } from "./types";
import type { ClientEffect } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import {
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
  CapabilityTextarea,
  CapabilityTitle,
  ReportChatColumn,
  ReportEffectCard,
  ReportEffectsPanel,
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type ReportAgentTab = "report" | "goal" | "demo";

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

export function createReportFoundryClientTools(files: LocalWorkspaceFile[]): CapabilityClientTool[] {
  return createReportAgentClientTools({ files });
}

export const reportFoundryCapability: CapabilityDefinition = {
  id: "report-agent",
  path: "/capabilities/report-agent",
  navLabel: "Report Agent",
  title: "Report Agent",
  eyebrow: "Capability",
  description: "Narrative report assembly with CSV, chart, and PDF handoffs.",
  tabs: [
    { id: "report", label: "Report" },
    { id: "goal", label: "Goal" },
    { id: "demo", label: "Demo" },
  ],
};

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
    files,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearFiles,
    handleRemoveFile,
    setFiles,
  } = useCapabilityFileWorkspace({
    capabilityId: reportFoundryCapability.id,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "report",
    allowedTabs: ["report", "goal", "demo"],
  });
  const capabilityBundle = useMemo(() => buildReportAgentBundle(), []);
  const clientTools = useMemo<CapabilityClientTool[]>(() => createReportFoundryClientTools(files), [files]);
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
    reloadScenario,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    buildDemoScenario: buildReportAgentDemoScenario,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: reportFoundryCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      files,
      accept: ".csv,.json,.pdf",
      onSelectFiles: handleFiles,
      onClearFiles: handleClearFiles,
      onRemoveFile: handleRemoveFile,
    });
  }, [files, handleClearFiles, handleFiles, handleRemoveFile, onRegisterWorkspace]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{reportFoundryCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{reportFoundryCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Lead an investigation, hand off to specialists when needed, and assemble a narrative report over local files.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {reportFoundryCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
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
              <MetaText>
                Current goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the investigation."}
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
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "goal" ? (
        <InvestigationBriefPanel
          investigationBrief={investigationBrief}
          setInvestigationBrief={setInvestigationBrief}
        />
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading ? "Preparing the report demo." : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}</MetaText>
              <MetaText>Demo: {demoScenario?.title ?? "Preparing scenario"}</MetaText>
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
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
              onReloadScenario={reloadScenario}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </>
  );
}
