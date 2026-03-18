import { buildChartAgentClientToolCatalog } from "./chart-agent/tools";
import { buildCsvAgentClientToolCatalog } from "./csv-agent/tools";
import { buildPdfAgentClientToolCatalog } from "./pdf-agent/tools";
import { REPORT_AGENT_INSTRUCTIONS } from "./report-agent/instructions";
import { buildReportAgentClientToolCatalog } from "./report-agent/tools";
import { buildWorkspaceAgentClientToolCatalog } from "./workspace-agent/tools";
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
6. When the next step is clear from the request and the available files, continue without unnecessary confirmation.
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
6. When the best chart is clear from the available artifact, render it without asking for unnecessary confirmation.
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
5. Prefer section-based splits whenever inspection reveals clear structural boundaries.
6. Use \`make_plan\` when it helps you structure the splitting task, then continue executing it.
7. When the document structure is clear enough to act on, continue without asking for unnecessary confirmation.
`.trim();

const FEEDBACK_AGENT_INSTRUCTIONS = `
You are the Feedback Agent for the client workspace.

Your responsibilities:
- gather concise, actionable feedback about the current thread
- use the full thread as context while interpreting the user's intent
- focus on the latest assistant response unless the user clearly points to another response
- keep the exchange short and strictly about feedback capture

Important operating rules:
1. Use \`start_feedback_capture_for_latest_response\` promptly when the user wants to provide feedback.
2. Pass any already-clear sentiment, label, or short note as defaults when helpful.
3. Do not drift into solving the original task unless that is necessary to clarify the feedback.
4. If there is no assistant response yet, say so plainly.
`.trim();

const WORKSPACE_AGENT_INSTRUCTIONS = `
You are the Workspace Agent for the client-side workspace filesystem.

Your responsibilities:
- describe the current working directory
- create directories
- change the current working directory
- keep workspace navigation explicit and simple

Important operating rules:
1. Start with \`get_workspace_context\` when the current workspace state is unclear.
2. Use relative or absolute paths explicitly.
3. Create directories before changing into them when needed.
4. Do not invent file operations that are not present in the current tool catalog.
`.trim();

const WORKSPACE_HANDOFF = {
  capability_id: "workspace-agent",
  tool_name: "delegate_to_workspace_agent",
  description:
    "Hand off to the Workspace Agent when the next step is inspecting the current working directory, creating directories, or changing directories.",
} as const;

const FEEDBACK_HANDOFF = {
  capability_id: "feedback-agent",
  tool_name: "delegate_to_feedback_agent",
  description:
    "Hand off to the Feedback Agent when the user wants to provide structured feedback about the current thread.",
} as const;

export function buildCsvAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "csv-agent",
    agent_name: "CSV Agent",
    instructions: CSV_AGENT_INSTRUCTIONS,
    client_tools: buildCsvAgentClientToolCatalog(),
    handoff_targets: [
      WORKSPACE_HANDOFF,
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description:
          "Hand off to the Chart Agent when the next step is chart planning or rendering from a chartable CSV or JSON artifact.",
      },
      FEEDBACK_HANDOFF,
    ],
  };
}

export function buildChartAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "chart-agent",
    agent_name: "Chart Agent",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(),
    handoff_targets: [WORKSPACE_HANDOFF, FEEDBACK_HANDOFF],
  };
}

export function buildPdfAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "pdf-agent",
    agent_name: "PDF Agent",
    instructions: PDF_AGENT_INSTRUCTIONS,
    client_tools: buildPdfAgentClientToolCatalog(),
    handoff_targets: [WORKSPACE_HANDOFF, FEEDBACK_HANDOFF],
  };
}

export function buildFeedbackAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "feedback-agent",
    agent_name: "Feedback Agent",
    instructions: FEEDBACK_AGENT_INSTRUCTIONS,
    client_tools: [],
    handoff_targets: [],
  };
}

export function buildWorkspaceAgentSpec(): CapabilityAgentSpec {
  return {
    capability_id: "workspace-agent",
    agent_name: "Workspace Agent",
    instructions: WORKSPACE_AGENT_INSTRUCTIONS,
    client_tools: buildWorkspaceAgentClientToolCatalog(),
    handoff_targets: [],
  };
}

export function buildReportAgentSpec(reportIds: readonly string[] = ["report-1"]): CapabilityAgentSpec {
  return {
    capability_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(reportIds),
    handoff_targets: [
      WORKSPACE_HANDOFF,
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
      FEEDBACK_HANDOFF,
    ],
  };
}

export function buildCsvAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "csv-agent",
    capabilities: [
      buildCsvAgentSpec(),
      buildChartAgentSpec(),
      buildFeedbackAgentSpec(),
      buildWorkspaceAgentSpec(),
    ],
  };
}

export function buildChartAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "chart-agent",
    capabilities: [buildChartAgentSpec(), buildWorkspaceAgentSpec(), buildFeedbackAgentSpec()],
  };
}

export function buildWorkspaceAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "workspace-agent",
    capabilities: [buildWorkspaceAgentSpec()],
  };
}

export function buildPdfAgentBundle(): CapabilityBundle {
  return {
    root_capability_id: "pdf-agent",
    capabilities: [buildPdfAgentSpec(), buildWorkspaceAgentSpec(), buildFeedbackAgentSpec()],
  };
}

export function buildReportAgentBundle(reportIds: readonly string[] = ["report-1"]): CapabilityBundle {
  return {
    root_capability_id: "report-agent",
    capabilities: [
      buildReportAgentSpec(reportIds),
      buildCsvAgentSpec(),
      buildChartAgentSpec(),
      buildPdfAgentSpec(),
      buildWorkspaceAgentSpec(),
      buildFeedbackAgentSpec(),
    ],
  };
}
