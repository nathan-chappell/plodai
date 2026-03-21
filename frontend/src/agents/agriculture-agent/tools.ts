import {
  inspectImageFileToolSchema,
  listImageFilesToolSchema,
} from "../../lib/tool-schemas";
import {
  buildToolDefinition,
  createBrokeredAgentTool,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

export function buildAgricultureAgentImageToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_image_files",
      "List image exports so the model can select the right plant or field photo.",
      listImageFilesToolSchema,
      {
        label: "List Image Files",
      },
    ),
    buildToolDefinition(
      "inspect_image_file",
      "Prepare an image export for visual inspection by returning image metadata plus an imageDataUrl that ChatKit forwards to the model as vision input.",
      inspectImageFileToolSchema,
      {
        label: "Inspect Image File",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "image" },
      },
    ),
  ];
}

export function createAgricultureAgentImageTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildAgricultureAgentImageToolCatalog().map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as "list_image_files" | "inspect_image_file",
    ),
  );
}
