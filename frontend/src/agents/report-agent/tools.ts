import {
  appendReportSlideToolSchema,
  createReportToolSchema,
  getReportToolSchema,
  listReportsToolSchema,
  removeReportSlideToolSchema,
} from "../../lib/tool-schemas";
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
  return workspace
    .listArtifacts()
    .filter((artifact) => artifact.kind === "report.v1")
    .map((artifact) => artifact.id);
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
      "List structured report artifacts stored in the current workspace.",
      listReportsToolSchema,
      {
        label: "List Reports",
      },
    ),
    buildToolDefinition(
      "get_report",
      "Read a structured report document from the current workspace.",
      withReportIdEnum(getReportToolSchema, workspace),
      {
        label: "Get Report",
        prominent_args: ["report_id"],
        arg_labels: { report_id: "report" },
      },
    ),
    buildToolDefinition(
      "create_report",
      "Create a new structured report artifact in the current workspace only when no suitable active report exists or the user explicitly wants a separate one.",
      createReportToolSchema,
      {
        label: "Create Report",
        prominent_args: ["title", "report_id"],
        arg_labels: { title: "title", report_id: "id" },
      },
    ),
    buildToolDefinition(
      "append_report_slide",
      "Append a structured report slide to a report artifact in the current workspace.",
      withReportIdEnum(appendReportSlideToolSchema, workspace),
      {
        label: "Append Report Slide",
        prominent_args: ["slide.title", "report_id"],
        arg_labels: { "slide.title": "slide", report_id: "report" },
      },
    ),
    buildToolDefinition(
      "remove_report_slide",
      "Remove a report slide from a structured report artifact in the current workspace.",
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
