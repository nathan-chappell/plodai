import {
  appendReportItemToolSchema,
  createReportToolSchema,
  getReportToolSchema,
  listReportsToolSchema,
  removeReportItemToolSchema,
} from "../../lib/tool-schemas";
import { readWorkspaceReportIndex } from "../../lib/workspace-contract";
import type { JsonSchema } from "../../types/json-schema";
import {
  buildToolDefinition,
  cloneSchema,
  createBrokeredCapabilityTool,
  isObjectSchema,
} from "../shared/tool-helpers";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

function reportIdsForWorkspace(workspace: CapabilityWorkspaceContext): string[] {
  const reportIndex = readWorkspaceReportIndex(workspace.getState().filesystem);
  return reportIndex?.report_ids ?? [];
}

function withReportIdEnum(
  schema: JsonSchema,
  workspace: CapabilityWorkspaceContext,
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
  workspace: CapabilityWorkspaceContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_reports",
      "List structured reports stored in the shared workspace.",
      listReportsToolSchema,
    ),
    buildToolDefinition(
      "get_report",
      "Read a structured report document from the shared workspace.",
      withReportIdEnum(getReportToolSchema, workspace),
    ),
    buildToolDefinition(
      "create_report",
      "Create a new structured report in the shared workspace and make it available for follow-on updates.",
      createReportToolSchema,
    ),
    buildToolDefinition(
      "append_report_item",
      "Append a narrative report item to a structured report in the shared workspace.",
      withReportIdEnum(appendReportItemToolSchema, workspace),
    ),
    buildToolDefinition(
      "remove_report_item",
      "Remove a report item from a structured report in the shared workspace.",
      withReportIdEnum(removeReportItemToolSchema, workspace),
    ),
  ];
}

export function createReportAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return buildReportAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredCapabilityTool(
      workspace,
      definition,
      definition.name as
        | "list_reports"
        | "get_report"
        | "create_report"
        | "append_report_item"
        | "remove_report_item",
    ),
  );
}
