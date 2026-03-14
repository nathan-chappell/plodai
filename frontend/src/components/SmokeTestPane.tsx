import { useMemo, useState } from "react";
import styled from "styled-components";

import { createReportFoundryClientTools, reportFoundryCapability } from "../capabilities/reportFoundry";
import { ChatKitHarness } from "./ChatKitPane";
import { DatasetChart } from "./DatasetChart";
import { createSmokeDatasets, runFrontendSmokeTest, type FrontendSmokeResult } from "../lib/smoke";
import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";
import { MetaText, panelSurfaceCss, primaryButtonCss } from "../ui/primitives";

const Panel = styled.section`
  ${panelSurfaceCss};
  padding: 1.2rem;
  display: grid;
  gap: 1rem;
`;

const Toolbar = styled.div`
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
`;

const Button = styled.button`
  ${primaryButtonCss};
  background: linear-gradient(135deg, var(--accent-deep), #9f4d21);
  color: #fffaf4;
`;

const ResultList = styled.div`
  display: grid;
  gap: 0.75rem;
`;

const ResultCard = styled.div<{ $ok: boolean }>`
  border-radius: var(--radius-md);
  padding: 0.85rem 0.95rem;
  border: 1px solid ${({ $ok }) => ($ok ? "rgba(34, 197, 94, 0.28)" : "rgba(220, 38, 38, 0.28)")};
  background: ${({ $ok }) => ($ok ? "rgba(34, 197, 94, 0.08)" : "rgba(220, 38, 38, 0.08)")};
`;

const AggregateTable = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  text-align: left;
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.14);
`;

const Td = styled.td`
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
`;

const ChartGrid = styled.div`
  display: grid;
  gap: 1rem;
`;

const Expectations = styled.ul`
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.45rem;
`;

const FORCING_PROMPT = [
  "This is a system smoke test for AI Portfolio.",
  "Use the attached CSV file tools that are already available in this thread.",
  "Start by listing the attached CSV files.",
  "Create exactly three charts from the sales fixture: a bar chart of revenue by region, a line chart of revenue by month, and a pie chart of revenue by category.",
  "Append a short report section titled Systems Test Summary that confirms whether the smoke test succeeded.",
  "Do not ask the user what to do next unless the test is blocked.",
].join(" ");

function isChartEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "chart_rendered" }> {
  return effect.type === "chart_rendered";
}

function isReportEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "report_section_appended" }> {
  return effect.type === "report_section_appended";
}

export function SmokeTestPane({
  onLoadFixtures,
}: {
  onLoadFixtures: (datasets: LocalDataset[]) => void;
}) {
  const [result, setResult] = useState<FrontendSmokeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [liveEffects, setLiveEffects] = useState<ClientEffect[]>([]);
  const smokeDatasets = useMemo(() => createSmokeDatasets(), []);

  async function handleRun() {
    setRunning(true);
    try {
      const nextResult = await runFrontendSmokeTest();
      setResult(nextResult);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel>
      <div>
        <h2>Frontend smoke test</h2>
        <MetaText>
          The deterministic runner below is a quick sanity check for the local query and chart helpers. The shared
          ChatKit harness further down runs the real browser-based flow with a forcing prompt and shows whatever the
          model actually produces.
        </MetaText>
      </div>

      <Toolbar>
        <Button type="button" onClick={handleRun} disabled={running}>
          {running ? "Running smoke test..." : "Run smoke test"}
        </Button>
        <Button type="button" onClick={() => onLoadFixtures(smokeDatasets)}>
          Load smoke datasets into workspace
        </Button>
      </Toolbar>

      {result ? (
        <>
          <MetaText>
            Overall result: {result.ok ? "PASS" : "FAIL"}. Listed {result.listedCsvFileCount} files and produced {result.chartEffects.length} charts.
          </MetaText>
          <ResultList>
            {result.assertions.map((assertion) => (
              <ResultCard key={assertion.label} $ok={assertion.ok}>
                <strong>{assertion.ok ? "PASS" : "FAIL"}: {assertion.label}</strong>
                <MetaText>{assertion.detail}</MetaText>
              </ResultCard>
            ))}
          </ResultList>

          {Object.entries(result.aggregateRowsByChart).map(([chartType, rows]) =>
            rows.length ? (
              <div key={chartType}>
                <h3>{chartType.toUpperCase()} aggregate output</h3>
                <AggregateTable>
                  <thead>
                    <tr>
                      {Object.keys(rows[0]).map((key) => (
                        <Th key={key}>{key}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${chartType}-${index}`}>
                        {Object.keys(rows[0]).map((key) => (
                          <Td key={`${chartType}-${index}-${key}`}>{String(row[key] ?? "")}</Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </AggregateTable>
              </div>
            ) : null,
          )}

          {result.chartEffects.length ? (
            <ChartGrid>
              {result.chartEffects.map((effect) => (
                <div key={effect.queryId}>
                  <h3>{effect.chart.title}</h3>
                  <DatasetChart spec={effect.chart} rows={effect.rows} />
                </div>
              ))}
            </ChartGrid>
          ) : null}
        </>
      ) : null}

      <div>
        <h2>Browser integration harness</h2>
        <MetaText>
          This uses the same ChatKit client-tool path as the normal workspace. Press the forcing prompt button and watch
          the stream, charts, and report updates happen in the browser.
        </MetaText>
      </div>
      <Expectations>
        <li>The agent should list the attached CSV files first.</li>
        <li>The ideal run creates a bar, line, and pie chart from the sales fixture.</li>
        <li>The ideal run appends a Systems Test Summary section before stopping.</li>
      </Expectations>

      <ChatKitHarness
        capabilityId={reportFoundryCapability.id}
        datasets={smokeDatasets}
        investigationBrief="Run the systems smoke scenario against the bundled CSV files and show the real browser rendering path."
        clientTools={createReportFoundryClientTools(smokeDatasets)}
        headerTitle="Smoke harness"
        greeting="Run the forcing prompt against bundled CSV fixtures."
        composerPlaceholder="Use the forcing prompt or explore the smoke fixtures manually"
        colorScheme="light"
        showDictation={false}
        prompts={[
          {
            label: "Run forcing prompt",
            prompt: FORCING_PROMPT,
            icon: "bolt",
          },
        ]}
        quickActions={[
          {
            label: "Run forcing prompt",
            prompt: FORCING_PROMPT,
            model: "lightweight",
          },
        ]}
        onEffects={(nextEffects) => setLiveEffects((current) => [...nextEffects, ...current].slice(0, 8))}
      />

      {liveEffects.length ? (
        <ResultList>
          {liveEffects.map((effect, index) =>
            isChartEffect(effect) ? (
              <ResultCard key={`${effect.type}-${effect.queryId}-${index}`} $ok>
                <strong>Rendered chart: {effect.chart.title}</strong>
                <MetaText>{effect.chart.type.toUpperCase()} chart requested by the agent.</MetaText>
                <DatasetChart spec={effect.chart} rows={effect.rows} />
              </ResultCard>
            ) : isReportEffect(effect) ? (
              <ResultCard key={`${effect.type}-${index}`} $ok>
                <strong>{effect.title}</strong>
                <MetaText>{effect.markdown}</MetaText>
              </ResultCard>
            ) : null,
          )}
        </ResultList>
      ) : null}
    </Panel>
  );
}
