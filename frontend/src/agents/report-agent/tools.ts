import {
  appendReportSlideToolSchema,
  createReportToolSchema,
  getReportToolSchema,
  listReportsToolSchema,
  removeReportSlideToolSchema,
} from "../../lib/tool-schemas";
import { listReports } from "../../lib/agent-reports";
import type { JsonSchema } from "../../types/json-schema";
import {
  buildToolDefinition,
  cloneSchema,
  createBrokeredAgentTool,
  isObjectSchema,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

function reportIdsForWorkspace(workspace: AgentRuntimeContext): string[] {
  return listReports(workspace.getAgentState(workspace.agentId)).map(
    (report) => report.report_id,
  );
}

function withReportIdEnum(
  schema: JsonSchema,
  workspace: AgentRuntimeContext,
): JsonSchema {
  const reportIds = reportIdsForWorkspace(workspace);
  const cloned = cloneSchema(schema);
  if (!reportIds.length || !isObjectSchema(cloned)) {
    return cloned;
  }
  cloned.properties = {
    ...cloned.properties,
    report_id: {
      ...(cloned.properties.report_id as JsonSchema),
      enum: reportIds,
    },
  };
  return cloned;
}

export function buildReportAgentClientToolCatalog(
  workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_reports",
      "List structured reports stored in the current report agent state.",
      listReportsToolSchema,
      {
        label: "List Reports",
      },
    ),
    buildToolDefinition(
      "get_report",
      "Read a structured report document from the current report agent state.",
      withReportIdEnum(getReportToolSchema, workspace),
      {
        label: "Get Report",
        prominent_args: ["report_id"],
        arg_labels: { report_id: "report" },
      },
    ),
    buildToolDefinition(
      "create_report",
      "Create a new structured report in the current report agent state only when no suitable active report exists or the user explicitly wants a separate one.",
      createReportToolSchema,
      {
        label: "Create Report",
        prominent_args: ["title", "report_id"],
        arg_labels: { title: "title", report_id: "id" },
      },
    ),
    buildToolDefinition(
      "append_report_slide",
      "Append a structured report slide to a report in the current report agent state.",
      withReportIdEnum(appendReportSlideToolSchema, workspace),
      {
        label: "Append Report Slide",
        prominent_args: ["slide.title", "report_id"],
        arg_labels: { "slide.title": "slide", report_id: "report" },
      },
    ),
    buildToolDefinition(
      "remove_report_slide",
      "Remove a report slide from a structured report in the current report agent state.",
      withReportIdEnum(removeReportSlideToolSchema, workspace),
      {
        label: "Remove Report Slide",
        prominent_args: ["report_id", "slide_id"],
        arg_labels: { report_id: "report", slide_id: "slide" },
      },
    ),
  ];
}

export function createReportAgentClientTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildReportAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as
        | "list_reports"
        | "get_report"
        | "create_report"
        | "append_report_slide"
        | "remove_report_slide",
    ),
  );
}
