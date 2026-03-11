import { FormEvent, useEffect, useState } from "react";
import styled from "styled-components";

import { AuthPanel } from "./components/AuthPanel";
import { ChartCard } from "./components/ChartCard";
import { ChatKitPane } from "./components/ChatKitPane";
import { NarrativeCard } from "./components/NarrativeCard";
import { ToolLog } from "./components/ToolLog";
import { apiRequest, getStoredToken, storeToken } from "./lib/api";
import { parseCsvPreview } from "./lib/csv";
import type { AuthUser } from "./types/auth";
import type { CreateReportResponse, DatasetSummary } from "./types/report";
import { MetaText, dashedInputSurfaceCss, displayHeadingCss, panelSurfaceCss, primaryButtonCss } from "./ui/primitives";

const Page = styled.main`
  padding: 2rem;
`;

const Shell = styled.div`
  width: min(1180px, 100%);
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

const Grid = styled.section`
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 1.5rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Panel = styled.section`
  ${panelSurfaceCss};
  border-radius: var(--radius-xl);
  padding: 1.4rem;
`;

const Label = styled.label`
  display: grid;
  gap: 0.55rem;
  margin-bottom: 1rem;
  color: var(--ink);
  font-weight: 600;
`;

const Textarea = styled.textarea`
  min-height: 160px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.95rem 1rem;
  background: rgba(255, 255, 255, 0.75);
  resize: vertical;
`;

const Input = styled.input`
  ${dashedInputSurfaceCss};
`;

const Button = styled.button`
  ${primaryButtonCss};
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
`;

const FilesList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.7rem;
`;

const FileCard = styled.li`
  padding: 0.9rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(201, 111, 59, 0.08);
  border: 1px solid rgba(201, 111, 59, 0.18);
`;

const ReportGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.2rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

export function App() {
  const [prompt, setPrompt] = useState(
    "Identify key trends, anomalies, and segments worth investigating. Build a concise executive-ready report.",
  );
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [report, setReport] = useState<CreateReportResponse | null>(null);
  const [status, setStatus] = useState<string>("Drop in CSVs and ask the analyst to investigate.");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

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

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setStatus("Profiling uploaded CSVs client-side before handing safe metadata to the backend.");
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
        } satisfies DatasetSummary;
      }),
    );

    setDatasets(nextDatasets);
    setStatus(`Prepared ${nextDatasets.length} dataset summaries.`);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      setStatus("Sign in before requesting a report.");
      return;
    }

    setBusy(true);
    setStatus("Requesting a report plan from the backend analyst agent.");

    try {
      const response = await apiRequest<CreateReportResponse>("/reports", {
        method: "POST",
        body: JSON.stringify({ prompt, datasets }),
      });
      setReport(response);
      setStatus("Report bundle created. Next step is wiring chart rendering plus image return for model interpretation.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <Shell>
        <Hero>
          <Eyebrow>Agentic CSV Intelligence Demo</Eyebrow>
          <Title>Report Foundry</Title>
          <Subhead>
            A lightweight demo for turning arbitrary CSV uploads into analyst-style reports with safe queries,
            rendered charts, and narrative sections assembled through ChatKit-friendly artifacts.
          </Subhead>
        </Hero>

        <Grid>
          <Panel>
            <form onSubmit={handleSubmit}>
              <Label>
                Investigation brief
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </Label>

              <Label>
                Attach CSV files
                <Input type="file" accept=".csv" multiple onChange={(event) => void handleFiles(event.target.files)} />
              </Label>

              <Button disabled={busy || !user} type="submit">
                {busy ? "Building report..." : "Generate report scaffold"}
              </Button>
            </form>
          </Panel>

          <AuthPanel user={user} onAuthenticated={setUser} />
        </Grid>

        <Grid>
          <Panel>
            <h2>Dataset inventory</h2>
            {datasets.length ? (
              <FilesList>
                {datasets.map((dataset) => (
                  <FileCard key={dataset.id}>
                    <strong>{dataset.name}</strong>
                    <MetaText as="div">
                      {dataset.row_count} rows · {dataset.columns.length} columns
                    </MetaText>
                    <MetaText as="div">{dataset.columns.join(", ")}</MetaText>
                    <MetaText as="div">
                      Numeric: {dataset.numeric_columns.length ? dataset.numeric_columns.join(", ") : "none inferred yet"}
                    </MetaText>
                  </FileCard>
                ))}
              </FilesList>
            ) : (
              <MetaText>No files yet. Upload one or more CSVs to create safe dataset summaries.</MetaText>
            )}
          </Panel>

          <ChatKitPane enabled={Boolean(user)} datasets={datasets} />
        </Grid>

        <ToolLog events={report?.tool_log ?? []} />

        {report ? (
          <ReportGrid>
            {report.sections.map((section) => (
              <NarrativeCard key={section.id} section={section} />
            ))}
            {report.charts.map((chart) => (
              <ChartCard key={chart.id} chart={chart} />
            ))}
          </ReportGrid>
        ) : (
          <Panel>
            <h2>Report canvas</h2>
            <MetaText>{status}</MetaText>
          </Panel>
        )}
      </Shell>
    </Page>
  );
}
