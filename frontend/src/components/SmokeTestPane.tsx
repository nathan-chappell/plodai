import { useMemo, useState } from "react";

import { createReportFoundryClientTools, reportFoundryCapability } from "../capabilities/reportFoundry";
import { buildReportAgentManifest } from "../capabilities/manifests";
import { ChatKitHarness } from "./ChatKitPane";
import { DatasetChart } from "./DatasetChart";
import { createSmokeDatasets, runFrontendSmokeTest, type FrontendSmokeResult } from "../lib/smoke";
import {
  SmokeTestAggregateTable,
  SmokeTestButton,
  SmokeTestChartGrid,
  SmokeTestExpectations,
  SmokeTestPanel,
  SmokeTestResultCard,
  SmokeTestResultList,
  SmokeTestTd,
  SmokeTestTh,
  SmokeTestToolbar,
} from "./styles";
import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";
import { MetaText } from "../app/styles";

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
  const capabilityManifest = useMemo(() => buildReportAgentManifest(), []);

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
    <SmokeTestPanel>
      <div>
        <h2>Frontend smoke test</h2>
        <MetaText>
          The deterministic runner below is a quick sanity check for the local query and chart helpers. The shared
          ChatKit harness further down runs the real browser-based flow with a forcing prompt and shows whatever the
          model actually produces.
        </MetaText>
      </div>

      <SmokeTestToolbar>
        <SmokeTestButton type="button" onClick={handleRun} disabled={running}>
          {running ? "Running smoke test..." : "Run smoke test"}
        </SmokeTestButton>
        <SmokeTestButton type="button" onClick={() => onLoadFixtures(smokeDatasets)}>
          Load smoke datasets into workspace
        </SmokeTestButton>
      </SmokeTestToolbar>

      {result ? (
        <>
          <MetaText>
            Overall result: {result.ok ? "PASS" : "FAIL"}. Listed {result.listedCsvFileCount} files and produced {result.chartEffects.length} charts.
          </MetaText>
          <SmokeTestResultList>
            {result.assertions.map((assertion) => (
              <SmokeTestResultCard key={assertion.label} $ok={assertion.ok}>
                <strong>{assertion.ok ? "PASS" : "FAIL"}: {assertion.label}</strong>
                <MetaText>{assertion.detail}</MetaText>
              </SmokeTestResultCard>
            ))}
          </SmokeTestResultList>

          {Object.entries(result.aggregateRowsByChart).map(([chartType, rows]) =>
            rows.length ? (
              <div key={chartType}>
                <h3>{chartType.toUpperCase()} aggregate output</h3>
                <SmokeTestAggregateTable>
                  <thead>
                    <tr>
                      {Object.keys(rows[0]).map((key) => (
                        <SmokeTestTh key={key}>{key}</SmokeTestTh>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${chartType}-${index}`}>
                        {Object.keys(rows[0]).map((key) => (
                          <SmokeTestTd key={`${chartType}-${index}-${key}`}>{String(row[key] ?? "")}</SmokeTestTd>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </SmokeTestAggregateTable>
              </div>
            ) : null,
          )}

          {result.chartEffects.length ? (
            <SmokeTestChartGrid>
              {result.chartEffects.map((effect) => (
                <div key={effect.queryId}>
                  <h3>{effect.chart.title}</h3>
                  <DatasetChart spec={effect.chart} rows={effect.rows} />
                </div>
              ))}
            </SmokeTestChartGrid>
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
      <SmokeTestExpectations>
        <li>The agent should list the attached CSV files first.</li>
        <li>The ideal run creates a bar, line, and pie chart from the sales fixture.</li>
        <li>The ideal run appends a Systems Test Summary section before stopping.</li>
      </SmokeTestExpectations>

      <ChatKitHarness
        capabilityManifest={capabilityManifest}
        files={smokeDatasets}
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
        <SmokeTestResultList>
          {liveEffects.map((effect, index) =>
            isChartEffect(effect) ? (
              <SmokeTestResultCard key={`${effect.type}-${effect.queryId}-${index}`} $ok>
                <strong>Rendered chart: {effect.chart.title}</strong>
                <MetaText>{effect.chart.type.toUpperCase()} chart requested by the agent.</MetaText>
                <DatasetChart spec={effect.chart} rows={effect.rows} />
              </SmokeTestResultCard>
            ) : isReportEffect(effect) ? (
              <SmokeTestResultCard key={`${effect.type}-${index}`} $ok>
                <strong>{effect.title}</strong>
                <MetaText>{effect.markdown}</MetaText>
              </SmokeTestResultCard>
            ) : null,
          )}
        </SmokeTestResultList>
      ) : null}
    </SmokeTestPanel>
  );
}
