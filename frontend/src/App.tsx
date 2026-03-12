import { useEffect, useState } from "react";
import styled from "styled-components";

import { AdminPanel } from "./components/AdminPanel";
import { AuthPanel } from "./components/AuthPanel";
import { ChatKitPane } from "./components/ChatKitPane";
import { DatasetChart } from "./components/DatasetChart";
import { NarrativeCard } from "./components/NarrativeCard";
import { SmokeTestPane } from "./components/SmokeTestPane";
import { DatasetInventoryPane } from "./components/DatasetInventoryPane";
import { apiRequest, getStoredToken, storeToken } from "./lib/api";
import { parseCsvPreview } from "./lib/csv";
import type { AuthUser } from "./types/auth";
import type { ClientEffect } from "./types/analysis";
import type { LocalDataset } from "./types/report";
import { MetaText, displayHeadingCss, panelSurfaceCss } from "./ui/primitives";

const BRIEF_STORAGE_KEY = "report-foundry-investigation-brief";

type WorkspaceTab = "report" | "datasets" | "goal" | "smoke" | "admin";

const Page = styled.main`
  padding: 2rem;
`;

const Shell = styled.div`
  width: min(1320px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 1.5rem;
`;

const Hero = styled.section`
  display: grid;
  gap: 1rem;
  padding: 2rem;
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, rgba(255, 252, 247, 0.95), rgba(241, 228, 214, 0.92));
  border: 1px solid rgba(31, 41, 55, 0.08);
  box-shadow: var(--shadow);
`;

const Eyebrow = styled.div`
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-deep);
  font-size: 0.78rem;
`;

const Title = styled.h1`
  ${displayHeadingCss};
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 4.5rem);
  line-height: 0.95;
`;

const Subhead = styled.p`
  margin: 0;
  max-width: 70ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.75;
`;

const LoginGrid = styled.section`
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 1.5rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const FeatureList = styled.ul`
  margin: 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 0.8rem;
  color: var(--ink);
`;

const WorkspaceHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 1rem;
  align-items: start;

  @media (max-width: 1000px) {
    grid-template-columns: 1fr;
  }
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

const SectionTitle = styled.h2`
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

export function App() {
  const [datasets, setDatasets] = useState<LocalDataset[]>([]);
  const [status, setStatus] = useState<string>("Add CSV files to begin a local-first investigation.");
  const [user, setUser] = useState<AuthUser | null>(null);
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
    async function hydrateUser() {
      if (!getStoredToken()) {
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/auth/me");
        setUser(me);
      } catch {
        storeToken(null);
      }
    }

    void hydrateUser();
  }, []);

  useEffect(() => {
    if (activeWorkspaceTab === "admin" && user?.role !== "admin") {
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

  if (!user) {
    return (
      <Page>
        <Shell>
          <Hero>
            <Eyebrow>Agentic CSV Intelligence Demo</Eyebrow>
            <Title>Report Foundry</Title>
            <Subhead>
              Analyze some CSV files locally, let an agent explore them through safe aggregations and charts, and turn the
              findings into a clean narrative report.
            </Subhead>
          </Hero>

          <LoginGrid>
            <Panel>
              <SectionHeader>
                <SectionTitle>What this demo does</SectionTitle>
                <MetaText>The files stay client-side. The agent works through safe tools, chart rendering, and thread-aware state.</MetaText>
              </SectionHeader>
              <FeatureList>
                <li>Profile multiple CSV files locally and expose only metadata, samples, and aggregate query results.</li>
                <li>Let the agent explore, compare segments, validate anomalies, and request charts it can inspect visually.</li>
                <li>Keep the investigation goal and dataset state attached to the thread so the workspace stays coherent.</li>
              </FeatureList>
            </Panel>

            <AuthPanel
              user={user}
              onAuthenticated={setUser}
              heading="Sign in to open the analyst workspace"
              subtitle="Once you are in, you can add local CSV files and start the investigation immediately."
            />
          </LoginGrid>
        </Shell>
      </Page>
    );
  }

  return (
    <Page>
      <Shell>
        <WorkspaceHeader>
          <Hero>
            <Eyebrow>Agentic CSV Intelligence Demo</Eyebrow>
            <Title>Report Foundry</Title>
            <Subhead>
              Load local datasets, define the investigation goal, and let the analyst explore the files through safe queries,
              charts, and narrative writeups.
            </Subhead>
          </Hero>

          <AuthPanel
            user={user}
            onAuthenticated={setUser}
            mode="account"
            heading="Workspace session"
            subtitle="You are signed in. Add files, set the goal, and investigate from the workspace."
          />
        </WorkspaceHeader>

        <TabBar>
          <TabButton $active={activeWorkspaceTab === "report"} onClick={() => setActiveWorkspaceTab("report")} type="button">
            Report
          </TabButton>
          <TabButton $active={activeWorkspaceTab === "datasets"} onClick={() => setActiveWorkspaceTab("datasets")} type="button">
            Datasets
          </TabButton>
          <TabButton $active={activeWorkspaceTab === "goal"} onClick={() => setActiveWorkspaceTab("goal")} type="button">
            Goal
          </TabButton>
          <TabButton $active={activeWorkspaceTab === "smoke"} onClick={() => setActiveWorkspaceTab("smoke")} type="button">
            Smoke
          </TabButton>
          {user.role === "admin" ? (
            <TabButton $active={activeWorkspaceTab === "admin"} onClick={() => setActiveWorkspaceTab("admin")} type="button">
              Admin
            </TabButton>
          ) : null}
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
                  Good starting moves: summarize every file, compare the most important segments, validate anomalies with a second
                  query, and leave behind short report sections as the investigation develops.
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
                enabled={Boolean(user)}
                datasets={datasets}
                investigationBrief={investigationBrief}
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
      </Shell>
    </Page>
  );
}
