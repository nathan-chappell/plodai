import { expect, test } from "@playwright/test";

import { runDemoFireTest, shouldRunDemo, type DemoConfig } from "./support/fire-test";

const demoConfigs: DemoConfig[] = [
  {
    capabilityId: "csv-agent",
    path: "/capabilities/csv-agent",
    requiredToolNames: ["run_aggregate_query"],
    requiredResponseMarkers: ["tool_trace_widget"],
    postRunAssertion: async (_page, snapshot) => {
      const toolNames = snapshot.clientToolCalls.map((call) => call.name);
      expect(toolNames.some((name) => name === "list_workspace_files" || name === "list_attached_csv_files")).toBe(true);
      const derivedFiles = snapshot.appendedFiles.filter((file) => file.kind === "csv" || file.kind === "json");
      expect(derivedFiles.length).toBeGreaterThan(0);
    },
  },
  {
    capabilityId: "chart-agent",
    path: "/capabilities/chart-agent",
    requiredToolNames: ["list_chartable_files", "inspect_chartable_file_schema", "render_chart_from_file"],
    requiredEffectNames: ["chart_rendered"],
    requiredResponseMarkers: ["plan_widget"],
    visibleSelectors: ["chart-agent-demo-effects", "chart-agent-demo-chart-effect"],
  },
  {
    capabilityId: "pdf-agent",
    path: "/capabilities/pdf-agent",
    requiredToolNames: ["inspect_pdf_file", "smart_split_pdf"],
    requiredEffectNames: ["pdf_smart_split_completed"],
    visibleSelectors: ["pdf-agent-demo-effects", "pdf-agent-demo-pdf-effect"],
    postRunAssertion: async (_page, snapshot) => {
      expect(snapshot.appendedFiles.length).toBeGreaterThan(1);
    },
  },
  {
    capabilityId: "report-agent",
    path: "/capabilities/report-agent",
    requiredToolNames: ["list_workspace_files"],
    requiredEffectNames: ["report_section_appended"],
    visibleSelectors: ["report-agent-demo-effects", "report-agent-demo-report-effect"],
    postRunAssertion: async (page, snapshot) => {
      const specialistTools = snapshot.clientToolCalls
        .map((call) => call.name)
        .filter((name) =>
          [
            "run_aggregate_query",
            "create_csv_file",
            "create_json_file",
            "render_chart_from_file",
            "inspect_pdf_file",
            "smart_split_pdf",
          ].includes(name),
        );
      expect(specialistTools.length).toBeGreaterThan(0);
      await expect(page.getByTestId("narrative-card")).toBeVisible();
    },
  },
];

for (const config of demoConfigs) {
  test(`${config.capabilityId} live demo fire test`, async ({ page }, testInfo) => {
    test.skip(!shouldRunDemo(config.capabilityId), `Skipping because FIRE_TEST_DEMO is not ${config.capabilityId}.`);

    const consoleMessages: string[] = [];
    page.on("console", (message) => {
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });

    try {
      await runDemoFireTest(page, testInfo, config);
    } finally {
      await testInfo.attach(`${config.capabilityId}-console.log`, {
        body: consoleMessages.join("\n"),
        contentType: "text/plain",
      });
    }
  });
}
