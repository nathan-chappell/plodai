import { useMemo } from "react";

import { useAppState } from "../app/context";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { DatasetInventoryPane } from "../components/DatasetInventoryPane";
import { NarrativeCard } from "../components/NarrativeCard";
import { SmokeTestPane } from "../components/SmokeTestPane";
import { useReportFoundryWorkspace, type ReportFoundryWorkspaceTab } from "./hooks";
import { executeQueryPlanInWorker } from "../lib/analysis-worker-client";
import { renderChartToDataUrl } from "../lib/chart";
import type {
  ClientEffect,
  ClientToolArgsMap,
  DataRow,
  ListLoadedDatasetsToolArgs,
  RenderChartToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { LocalDataset } from "../types/report";
import { MetaText } from "../app/styles";
import type { CapabilityClientTool, CapabilityDefinition } from "./types";
import {
  CapabilityHeroRow,
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHighlight,
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
import { AuthPanel } from "../components/AuthPanel";

function isChartEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "chart_rendered" }> {
  return effect.type === "chart_rendered";
}

function isReportEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "report_section_appended" }> {
  return effect.type === "report_section_appended";
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
        <CapabilityMetaText>This brief is saved with the conversation so the analyst keeps the objective in view.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Compare regional performance, find the most surprising anomalies, and suggest the best charts."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          The analyst will use this as the working objective, then refine the thread title once the focus becomes clear.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

async function listAttachedCsvFilesTool(
  args: ListLoadedDatasetsToolArgs,
  datasets: LocalDataset[],
): Promise<Record<string, unknown>> {
  return {
    csv_files: datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      row_count: dataset.row_count,
      columns: dataset.columns,
      numeric_columns: dataset.numeric_columns,
      sample_rows: args.includeSamples ? dataset.sample_rows : [],
    })),
  };
}

async function runAggregateQueryTool(
  args: RunLocalQueryToolArgs,
  datasets: LocalDataset[],
): Promise<Record<string, unknown>> {
  const dataset = findDataset(datasets, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  return {
    rows: resultRows,
    row_count: resultRows.length,
  };
}

async function requestChartRenderTool(
  args: RenderChartToolArgs,
  datasets: LocalDataset[],
): Promise<{ payload: Record<string, unknown>; effect: ClientEffect }> {
  const dataset = findDataset(datasets, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const imageDataUrl = await renderChartToDataUrl(args.chart_plan, resultRows);
  return {
    payload: {
      rows: resultRows,
      row_count: resultRows.length,
      chart: args.chart_plan,
      query_id: args.query_id,
      imageDataUrl,
    },
    effect: {
      type: "chart_rendered",
      queryId: args.query_id,
      chart: args.chart_plan,
      imageDataUrl: imageDataUrl ?? undefined,
      rows: resultRows,
    },
  };
}

function findDataset(datasets: LocalDataset[], datasetId: string): LocalDataset {
  const dataset = datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetId}`);
  }
  return dataset;
}

export function createReportFoundryClientTools(datasets: LocalDataset[]): CapabilityClientTool[] {
  return [
    {
      type: "function",
      name: "list_attached_csv_files",
      description:
        "List the CSV files currently available on the client, including safe schema details, row counts, numeric columns, and tiny familiarization samples.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          includeSamples: { type: "boolean", description: "Whether to include tiny familiarization samples." },
        },
        additionalProperties: false,
      },
      handler: async (args) => listAttachedCsvFilesTool(args as ClientToolArgsMap["list_attached_csv_files"], datasets),
    },
    {
      type: "function",
      name: "run_aggregate_query",
      description:
        "Execute a validated aggregate query plan against the client-side CSV rows and return grouped or summary results.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query_plan: {
            type: "object",
            description: "A validated row/filter/group/aggregate plan for exactly one dataset.",
            additionalProperties: true,
          },
        },
        required: ["query_plan"],
        additionalProperties: false,
      },
      handler: async (args) => runAggregateQueryTool(args as ClientToolArgsMap["run_aggregate_query"], datasets),
    },
    {
      type: "function",
      name: "request_chart_render",
      description:
        "Run a validated query plan locally, render a chart on the client, and return the result rows plus chart metadata.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query_id: { type: "string" },
          query_plan: { type: "object", additionalProperties: true },
          chart_plan: { type: "object", additionalProperties: true },
        },
        required: ["query_id", "query_plan", "chart_plan"],
        additionalProperties: false,
      },
      handler: async (args, context) => {
        const result = await requestChartRenderTool(args as ClientToolArgsMap["request_chart_render"], datasets);
        context.emitEffect(result.effect);
        return result.payload;
      },
    },
  ];
}

export const reportFoundryCapability: CapabilityDefinition = {
  id: "report-foundry",
  path: "/capabilities/report-foundry",
  navLabel: "Report Foundry",
  title: "Report Foundry",
  eyebrow: "Capability",
  description: "Legacy CSV analysis workspace.",
  tabs: [
    { id: "report", label: "Report" },
    { id: "datasets", label: "Datasets" },
    { id: "goal", label: "Goal" },
    { id: "smoke", label: "Smoke" },
  ],
};

export function ReportFoundryPage() {
  const { user } = useAppState();
  if (!user) {
    return null;
  }
  const {
    datasets,
    status,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearDatasets,
    handleLoadSmokeDatasets,
  } = useReportFoundryWorkspace();
  const clientTools = useMemo<CapabilityClientTool[]>(() => createReportFoundryClientTools(datasets), [datasets]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{reportFoundryCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{reportFoundryCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Load local CSVs, set the goal, and investigate through safe queries and charts.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {reportFoundryCapability.tabs.map((tab) => (
            <CapabilityTabButton
              key={tab.id}
              $active={activeWorkspaceTab === tab.id}
              onClick={() => setActiveWorkspaceTab(tab.id as ReportFoundryWorkspaceTab)}
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
              <CapabilityMetaText>
                Uploaded files: {datasets.length ? datasets.map((dataset) => dataset.name).join(", ") : "none yet"}
              </CapabilityMetaText>
              <CapabilityMetaText>
                Current goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the investigation."}
              </CapabilityMetaText>
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
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityId={reportFoundryCapability.id}
              enabled
              datasets={datasets}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "datasets" ? (
        <DatasetInventoryPane
          datasets={datasets}
          onSelectFiles={handleFiles}
          onClearDatasets={handleClearDatasets}
        />
      ) : null}

      {activeWorkspaceTab === "goal" ? (
        <InvestigationBriefPanel
          investigationBrief={investigationBrief}
          setInvestigationBrief={setInvestigationBrief}
        />
      ) : null}

      {activeWorkspaceTab === "smoke" ? <SmokeTestPane onLoadFixtures={handleLoadSmokeDatasets} /> : null}
    </>
  );
}
