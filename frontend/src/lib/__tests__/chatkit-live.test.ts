// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { getCapabilityModule } from "../../capabilities/registry";
import { runCapabilityDemoScenario } from "../test-support/chatkit-live";

function widgetContains(
  result: Awaited<ReturnType<typeof runCapabilityDemoScenario>>,
  text: string,
): boolean {
  return result.widgets.some(
    (widget) =>
      widget.copy_text?.includes(text) === true ||
      widget.text_preview?.includes(text) === true,
  );
}

describe.sequential("capability live integration", () => {
  it(
    "runs the report-agent demo against the real ChatKit server and validates the backend wiring",
    async () => {
      const capabilityModule = getCapabilityModule("report-agent");
      if (!capabilityModule) {
        throw new Error("Report Agent module is not registered.");
      }

      const result = await runCapabilityDemoScenario(capabilityModule);
      const toolNames = new Set(result.toolCalls.map((toolCall) => toolCall.name));

      expect(
        result.deterministicChecks.passed,
        result.deterministicChecks.failures.join("\n") || "deterministic checks failed",
      ).toBe(true);
      expect(
        result.eventDiagnostics.error_events,
        JSON.stringify(result.eventDiagnostics.error_events, null, 2),
      ).toHaveLength(0);
      expect(result.eventDiagnostics.final_pending_tool_names).toHaveLength(0);
      expect(result.assistantTexts.length).toBeGreaterThan(0);
      expect(toolNames.has("list_reports")).toBe(true);
      expect(toolNames.has("create_report")).toBe(true);
      expect(
        ["run_aggregate_query", "create_csv_file", "create_json_file"].some((toolName) =>
          toolNames.has(toolName),
        ),
      ).toBe(true);
      expect(toolNames.has("render_chart_from_file")).toBe(true);
      expect(toolNames.has("append_report_slide")).toBe(true);
      expect(
        result.effects.some((effect) => effect.type === "chart_rendered"),
      ).toBe(true);
      expect(result.workspaceSummary.current_report?.slide_count ?? 0).toBeGreaterThan(0);
      expect(
        result.workspaceSummary.current_report?.slides.some((slide) =>
          slide.preview?.includes("Revenue") || slide.preview?.includes("bar"),
        ) ?? false,
      ).toBe(true);
      expect(result.requestMetadata.origin).toBe("ui_integration_test");
    },
    240_000,
  );

  it(
    "opens the feedback widget on first capture instead of asking for plain-text feedback",
    async () => {
      const capabilityModule = getCapabilityModule("feedback-agent");
      if (!capabilityModule) {
        throw new Error("Feedback Agent module is not registered.");
      }

      const result = await runCapabilityDemoScenario(capabilityModule);

      expect(
        result.deterministicChecks.passed,
        result.deterministicChecks.failures.join("\n") || "deterministic checks failed",
      ).toBe(true);
      expect(
        result.eventDiagnostics.error_events,
        JSON.stringify(result.eventDiagnostics.error_events, null, 2),
      ).toHaveLength(0);
      expect(result.eventDiagnostics.final_pending_tool_names).toHaveLength(0);
      expect(result.assistantTexts).toHaveLength(1);
      expect(widgetContains(result, "Capture feedback")).toBe(true);
      expect(widgetContains(result, "Message")).toBe(true);
      expect(result.requestMetadata.origin).toBe("ui_integration_test");
    },
    240_000,
  );

  it(
    "does not stop after a chart handoff without a real render in the csv-agent demo",
    async () => {
      const capabilityModule = getCapabilityModule("csv-agent");
      if (!capabilityModule) {
        throw new Error("CSV Agent module is not registered.");
      }

      const result = await runCapabilityDemoScenario(capabilityModule);
      const toolNames = new Set(result.toolCalls.map((toolCall) => toolCall.name));
      const hasChartHandoff = widgetContains(result, "CSV Agent -> Chart Agent");

      expect(
        result.deterministicChecks.passed,
        result.deterministicChecks.failures.join("\n") || "deterministic checks failed",
      ).toBe(true);
      expect(
        result.eventDiagnostics.error_events,
        JSON.stringify(result.eventDiagnostics.error_events, null, 2),
      ).toHaveLength(0);
      expect(result.eventDiagnostics.final_pending_tool_names).toHaveLength(0);
      expect(toolNames.has("list_csv_files")).toBe(true);
      expect(
        toolNames.has("create_csv_file") || toolNames.has("create_json_file"),
      ).toBe(true);
      expect(
        result.workspaceSummary.files.some(
          (file) => file.name !== "sales_demo.csv" && file.name !== "support_demo.csv",
        ),
      ).toBe(true);

      if (hasChartHandoff || toolNames.has("render_chart_from_file")) {
        expect(toolNames.has("render_chart_from_file")).toBe(true);
        expect(result.effects.some((effect) => effect.type === "chart_rendered")).toBe(true);
      }
      expect(result.requestMetadata.origin).toBe("ui_integration_test");
    },
    240_000,
  );
});
