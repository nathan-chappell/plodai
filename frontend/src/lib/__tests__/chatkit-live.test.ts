// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { getCapabilityModule } from "../../capabilities/registry";
import { runCapabilityDemoScenario } from "../test-support/chatkit-live";

describe.sequential("report-agent live integration", () => {
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
      expect(toolNames.has("append_report_item")).toBe(true);
      expect(
        result.effects.some((effect) => effect.type === "chart_rendered"),
      ).toBe(true);
      expect(result.workspaceSummary.current_report?.item_count ?? 0).toBeGreaterThan(0);
      expect(result.requestMetadata.origin).toBe("ui_integration_test");
      expect(result.requestMetadata.execution_mode).toBe("batch");
      expect(result.validation.passed).toBe(true);
      expect(result.validation.chart_seen).toBe(true);
      expect(result.validation.cost_snapshot.cost_usd).toBeGreaterThan(0);
    },
    240_000,
  );
});
