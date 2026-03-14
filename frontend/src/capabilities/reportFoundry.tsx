import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { AdminPanel } from "../components/AdminPanel";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { DatasetInventoryPane } from "../components/DatasetInventoryPane";
import { NarrativeCard } from "../components/NarrativeCard";
import { SmokeTestPane } from "../components/SmokeTestPane";
import { executeQueryPlan } from "../lib/analysis";
import { renderChartToDataUrl } from "../lib/chart";
import { parseCsvPreview } from "../lib/csv";
import type {
  ClientEffect,
  ClientToolArgsMap,
  DataRow,
  ListLoadedDatasetsToolArgs,
  RenderChartToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { AuthUser } from "../types/auth";
import type { LocalDataset } from "../types/report";
import { MetaText, displayHeadingCss, panelSurfaceCss } from "../ui/primitives";
import type { CapabilityClientTool, CapabilityDefinition } from "./types";

const BRIEF_STORAGE_KEY = "report-foundry-investigation-brief";

type WorkspaceTab = "report" | "datasets" | "goal" | "smoke" | "admin";

const Header = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  display: grid;
  gap: 0.9rem;
`;

const Eyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

const Title = styled.h2`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 3rem);
`;

const Subhead = styled.p`
  margin: 0;
  color: var(--muted);
  max-width: 72ch;
  line-height: 1.75;
`;

const TabBar = styled.div`
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
`;

const TabButton = styled.button<{ $active: boolean }>`
  border: 1px solid ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.38)" : "var(--line)")};
  background: ${({ $active }) => ($active ? "rgba(201, 111, 59, 0.14)" : "rgba(255, 255, 255, 0.55)")};
  color: var(--ink);
  border-radius: 999px;
  padding: 0.65rem 0.95rem;
  font-weight: 700;
  cursor: pointer;
`;

const ReportLayout = styled.section`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 430px;
  gap: 1.5rem;
  align-items: start;

  @media (max-width: 1180px) {
    grid-template-columns: 1fr;
  }
`;

const ReportColumn = styled.div`
  min-width: 0;
  display: grid;
  gap: 1rem;
`;

const ChatColumn = styled.div`
  min-width: 0;
`;

const Panel = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.4rem;
  display: grid;
  gap: 0.95rem;
`;

const SectionHeader = styled.div`
  display: grid;
  gap: 0.4rem;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 1.2rem;
`;

const Textarea = styled.textarea`
  min-height: 260px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.95rem 1rem;
  background: rgba(255, 255, 255, 0.75);
  resize: vertical;
  font: inherit;
`;

const Highlight = styled.div`
  padding: 0.95rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(201, 111, 59, 0.08);
  border: 1px solid rgba(201, 111, 59, 0.18);
`;

const EffectPanel = styled.div`
  display: grid;
  gap: 1rem;
`;

const EffectCard = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1rem;
  display: grid;
  gap: 0.8rem;
  min-width: 0;
`;

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
    <Panel>
      <SectionHeader>
        <SectionTitle>Analysis goal</SectionTitle>
        <MetaText>This brief is saved with the conversation so the analyst keeps the objective in view.</MetaText>
      </SectionHeader>
      <Textarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Compare regional performance, find the most surprising anomalies, and suggest the best charts."
      />
      <Highlight>
        <MetaText>
          The analyst will use this as the working objective, then refine the thread title once the focus becomes clear.
        </MetaText>
      </Highlight>
    </Panel>
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
  const result = executeQueryPlan(rows, args.query_plan);
  return {
    rows: result.rows,
    row_count: result.rows.length,
  };
}

async function requestChartRenderTool(
  args: RenderChartToolArgs,
  datasets: LocalDataset[],
): Promise<{ payload: Record<string, unknown>; effect: ClientEffect }> {
  const dataset = findDataset(datasets, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const result = executeQueryPlan(rows, args.query_plan);
  const imageDataUrl = await renderChartToDataUrl(args.chart_plan, result.rows);
  return {
    payload: {
      rows: result.rows,
      row_count: result.rows.length,
      chart: args.chart_plan,
      query_id: args.query_id,
      imageDataUrl,
    },
    effect: {
      type: "chart_rendered",
      queryId: args.query_id,
      chart: args.chart_plan,
      imageDataUrl: imageDataUrl ?? undefined,
      rows: result.rows,
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
  title: "Investigative CSV analytics",
  eyebrow: "Capability",
  description: "Profile local CSVs, explore them safely, and assemble report sections and charts in a guided workspace.",
  tabs: [
    { id: "report", label: "Report" },
    { id: "datasets", label: "Datasets" },
    { id: "goal", label: "Goal" },
    { id: "smoke", label: "Smoke" },
    { id: "admin", label: "Admin", visible: ({ role }) => role === "admin" },
  ],
};

export function ReportFoundryPage({
  user,
}: {
  user: AuthUser;
}) {
  const [datasets, setDatasets] = useState<LocalDataset[]>([]);
  const [status, setStatus] = useState<string>("Add CSV files to begin a local-first investigation.");
  const [investigationBrief, setInvestigationBrief] = useState(
    "Summarize the attached files, identify the strongest trends and anomalies, and explain what deserves follow-up.",
  );
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("report");
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);

  useEffect(() => {
    const savedBrief = window.localStorage.getItem(BRIEF_STORAGE_KEY);
    if (savedBrief) {
      setInvestigationBrief(savedBrief);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(BRIEF_STORAGE_KEY, investigationBrief);
  }, [investigationBrief]);

  useEffect(() => {
    if (activeWorkspaceTab === "admin" && user.role !== "admin") {
      setActiveWorkspaceTab("report");
    }
  }, [activeWorkspaceTab, user]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setStatus("Profiling selected CSV files locally before exposing safe metadata to the agent.");
    const nextDatasets = await Promise.all(
      Array.from(files).map(async (file) => {
        const preview = await parseCsvPreview(file);
        return {
          id: crypto.randomUUID(),
          name: file.name,
          row_count: preview.rowCount,
          columns: preview.columns,
          numeric_columns: preview.numericColumns,
          sample_rows: preview.sampleRows,
          rows: preview.rows,
          preview_rows: preview.previewRows,
        } satisfies LocalDataset;
      }),
    );

    setDatasets(nextDatasets);
    setReportEffects([]);
    setStatus(`Prepared ${nextDatasets.length} dataset summary${nextDatasets.length === 1 ? "" : "ies"} for analysis.`);
  }

  function handleClearDatasets() {
    setDatasets([]);
    setReportEffects([]);
    setStatus("Cleared dataset inventory. Add CSV files to begin another investigation.");
  }

  function handleLoadSmokeDatasets(nextDatasets: LocalDataset[]) {
    setDatasets(nextDatasets);
    setReportEffects([]);
    setStatus(`Loaded ${nextDatasets.length} smoke dataset${nextDatasets.length === 1 ? "" : "s"} into the workspace.`);
    setActiveWorkspaceTab("report");
  }

  const clientTools = useMemo<CapabilityClientTool[]>(() => createReportFoundryClientTools(datasets), [datasets]);

  return (
    <>
      <Header>
        <Eyebrow>{reportFoundryCapability.eyebrow}</Eyebrow>
        <Title>{reportFoundryCapability.title}</Title>
        <Subhead>
          Load local datasets, define the investigation goal, and let the analyst explore the files through safe queries,
          charts, and narrative writeups.
        </Subhead>
      </Header>

      <TabBar>
        {reportFoundryCapability.tabs
          .filter((tab) => !tab.visible || tab.visible({ role: user.role }))
          .map((tab) => (
            <TabButton
              key={tab.id}
              $active={activeWorkspaceTab === tab.id}
              onClick={() => setActiveWorkspaceTab(tab.id as WorkspaceTab)}
              type="button"
            >
              {tab.label}
            </TabButton>
          ))}
      </TabBar>

      {activeWorkspaceTab === "report" ? (
        <ReportLayout>
          <ReportColumn>
            <Panel>
              <SectionHeader>
                <SectionTitle>Report canvas</SectionTitle>
                <MetaText>{status}</MetaText>
              </SectionHeader>
              <MetaText>
                Good starting moves: summarize every file, compare the most important segments, validate anomalies with a
                second query, and leave behind short report sections as the investigation develops.
              </MetaText>
              <MetaText>
                Uploaded files: {datasets.length ? datasets.map((dataset) => dataset.name).join(", ") : "none yet"}
              </MetaText>
              <MetaText>
                Current goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the investigation."}
              </MetaText>
            </Panel>

            {reportEffects.length ? (
              <EffectPanel>
                {reportEffects.map((effect, index) => (
                  <EffectCard key={`${effect.type}-${index}`}>
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
                  </EffectCard>
                ))}
              </EffectPanel>
            ) : null}
          </ReportColumn>
          <ChatColumn>
            <ChatKitPane
              capabilityId={reportFoundryCapability.id}
              enabled
              datasets={datasets}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
            />
          </ChatColumn>
        </ReportLayout>
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

      {activeWorkspaceTab === "admin" && user.role === "admin" ? <AdminPanel currentUser={user} /> : null}
    </>
  );
}
