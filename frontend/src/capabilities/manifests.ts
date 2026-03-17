import { buildChartAgentClientToolCatalog } from "./chart-agent/tools";
import { buildCsvAgentClientToolCatalog } from "./csv-agent/tools";
import { buildPdfAgentClientToolCatalog } from "./pdf-agent/tools";
import { REPORT_AGENT_INSTRUCTIONS } from "./report-agent/instructions";
import { buildReportAgentClientToolCatalog } from "./report-agent/tools";
import type { CapabilityAgentSpec, CapabilityBundle } from "./types";

const CSV_AGENT_INSTRUCTIONS = `
You are the CSV Agent for local analyst workspaces.

Your responsibilities:
- inspect the available CSV files
- validate safe grouped or aggregate query plans
- create reusable CSV or JSON artifacts from query results
- hand off to the Chart Agent when the work becomes chart design

Important operating rules:
1. Start with \`list_workspace_files\` or \`list_attached_csv_files\`.
2. Inspect schema before writing or revising a query plan.
3. Prefer grouped aggregates and summaries over raw row dumps.
4. If a result set should be charted or reused, materialize it explicitly with \`create_csv_file\` or \`create_json_file\`.
5. Use \`make_plan\` when it helps you stay organized, then continue immediately with more tool calls.
`.trim();

const CHART_AGENT_INSTRUCTIONS = `
You are the Chart Agent.

Your responsibilities:
- inspect chartable CSV and JSON artifacts
- plan a chart before rendering it
- produce clear, beautiful Chart.js visualizations

Important operating rules:
1. Start with \`list_chartable_files\`.
2. Inspect the selected artifact schema before committing to a chart shape.
3. Always call \`make_plan\` before \`render_chart_from_file\`.
4. Use explicit keys for labels and series. Do not invent structure that is not present in the file.
5. JSON inputs must already be top-level arrays of objects.
`.trim();

const PDF_AGENT_INSTRUCTIONS = `
You are the PDF Agent for local document decomposition.

Your responsibilities:
- inspect PDFs for structure and likely sections
- extract bounded page ranges
- perform smart PDF splits and package the results

Important operating rules:
1. Start with \`list_workspace_files\`.
2. Call \`inspect_pdf_file\` before deciding how to split a document.
3. Keep extraction requests tightly bounded and explicit.
4. For smart split work, use the document structure plus user instructions to choose the most useful decomposition.
5. Use \`make_plan\` when it helps you structure the splitting task, then continue executing it.
`.trim();

export function buildCsvAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "csv-agent",
    agent_name: "CSV Agent",
    instructions: CSV_AGENT_INSTRUCTIONS,
    client_tools: buildCsvAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description:
          "Hand off to the Chart Agent when the next step is chart planning or rendering from a chartable CSV or JSON artifact.",
      },
    ],
  };
}

export function buildChartAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "chart-agent",
    agent_name: "Chart Agent",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(),
    handoff_targets: [],
  };
}

export function buildPdfAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "pdf-agent",
    agent_name: "PDF Agent",
    instructions: PDF_AGENT_INSTRUCTIONS,
    client_tools: buildPdfAgentClientToolCatalog(),
    handoff_targets: [],
  };
}

export function buildReportAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "csv-agent",
        tool_name: "delegate_to_csv_agent",
        description:
          "Hand off to the CSV Agent for CSV querying, schema work, and derived CSV or JSON artifact creation.",
      },
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description:
          "Hand off to the Chart Agent for chart planning or rendering from chartable CSV or JSON artifacts.",
      },
      {
        capability_id: "pdf-agent",
        tool_name: "delegate_to_pdf_agent",
        description:
          "Hand off to the PDF Agent for PDF inspection, page extraction, or smart splitting.",
      },
    ],
  };
}

export function buildCsvAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "csv-agent",
    capabilities: [buildCsvAgentSpec(), buildChartAgentSpec()],
  };
}

export function buildChartAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "chart-agent",
    capabilities: [buildChartAgentSpec()],
  };
}

export function buildPdfAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "pdf-agent",
    capabilities: [buildPdfAgentSpec()],
  };
}

export function buildReportAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "report-agent",
    capabilities: [
      buildReportAgentSpec(),
      buildCsvAgentSpec(),
      buildChartAgentSpec(),
      buildPdfAgentSpec(),
    ],
  };
}
