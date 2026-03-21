// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { getAgentModule } from "../../agents/registry";
import { runAgentDemoScenario } from "../test-support/chatkit-live";

function widgetContains(
  result: Awaited<ReturnType<typeof runAgentDemoScenario>>,
  text: string,
): boolean {
  return result.widgets.some(
    (widget) =>
      widget.copy_text?.includes(text) === true ||
      widget.text_preview?.includes(text) === true,
  );
}

describe.sequential("agent live integration", () => {
  it(
    "runs the report-agent demo against the real ChatKit server and validates the backend wiring",
    async () => {
      const agentModule = getAgentModule("report-agent");
      if (!agentModule) {
        throw new Error("Report Agent module is not registered.");
      }

      const result = await runAgentDemoScenario(agentModule);
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
        ["run_aggregate_query", "create_dataset", "create_dataset"].some((toolName) =>
          toolNames.has(toolName),
        ),
      ).toBe(true);
      expect(toolNames.has("render_chart_from_dataset")).toBe(true);
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
      const agentModule = getAgentModule("feedback-agent");
      if (!agentModule) {
        throw new Error("Feedback Agent module is not registered.");
      }

      const result = await runAgentDemoScenario(agentModule);

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
    "does not stop after analysis work without producing a real chart render when the run goes down the chart path",
    async () => {
      const agentModule = getAgentModule("analysis-agent");
      if (!agentModule) {
        throw new Error("Analysis Agent module is not registered.");
      }

      const result = await runAgentDemoScenario(agentModule);
      const toolNames = new Set(result.toolCalls.map((toolCall) => toolCall.name));
      const hasChartHandoff = widgetContains(result, "Analysis Agent -> Chart Agent");

      expect(
        result.deterministicChecks.passed,
        result.deterministicChecks.failures.join("\n") || "deterministic checks failed",
      ).toBe(true);
      expect(
        result.eventDiagnostics.error_events,
        JSON.stringify(result.eventDiagnostics.error_events, null, 2),
      ).toHaveLength(0);
      expect(result.eventDiagnostics.final_pending_tool_names).toHaveLength(0);
      expect(toolNames.has("list_datasets")).toBe(true);
      expect(
        toolNames.has("create_dataset") || toolNames.has("create_dataset"),
      ).toBe(true);
      expect(
        result.workspaceSummary.files.some(
          (file) => file.name !== "sales_demo.csv" && file.name !== "support_demo.csv",
        ),
      ).toBe(true);

      if (hasChartHandoff || toolNames.has("render_chart_from_dataset")) {
        expect(toolNames.has("render_chart_from_dataset")).toBe(true);
        expect(result.effects.some((effect) => effect.type === "chart_rendered")).toBe(true);
      }
      expect(result.requestMetadata.origin).toBe("ui_integration_test");
    },
    240_000,
  );
});
