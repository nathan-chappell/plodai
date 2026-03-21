import {
  getPdfPageRangeToolSchema,
  includeSamplesSchema,
  inspectPdfFileToolSchema,
  smartSplitPdfToolSchema,
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

function pdfFileIds(workspace: AgentRuntimeContext): string[] {
  return workspace
    .listSharedResources()
    .filter(
      (resource) =>
        resource.kind === "document" &&
        resource.payload.type === "document" &&
        resource.payload.file.kind === "pdf",
    )
    .map((resource) => resource.id);
}

function withPdfFileIdEnum(
  schema: JsonSchema,
  workspace: AgentRuntimeContext,
): JsonSchema {
  const fileIds = pdfFileIds(workspace);
  const cloned = cloneSchema(schema);
  if (!fileIds.length || !isObjectSchema(cloned)) {
    return cloned;
  }
  cloned.properties = {
    ...cloned.properties,
    file_id: {
      ...(cloned.properties.file_id as JsonSchema),
      enum: fileIds,
    },
  };
  return cloned;
}

export function buildDocumentAgentClientToolCatalog(
  workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_pdf_files",
      "List PDF files from shared agent exports, including lightweight metadata and tiny familiarization samples when requested.",
      includeSamplesSchema,
      {
        label: "List PDF Files",
        omit_args: ["includeSamples"],
      },
    ),
    buildToolDefinition(
      "inspect_pdf_file",
      "Inspect a PDF locally, returning page count, outline or bookmark hints, and page-level structure summaries.",
      withPdfFileIdEnum(inspectPdfFileToolSchema, workspace),
      {
        label: "Inspect PDF File",
        prominent_args: ["file_id", "max_pages"],
        arg_labels: { file_id: "file", max_pages: "max" },
      },
    ),
    buildToolDefinition(
      "get_pdf_page_range",
      "Extract an inclusive page range from a PDF file, add the derived sub-PDF to the current agent exports, and return it as a file input payload.",
      withPdfFileIdEnum(getPdfPageRangeToolSchema, workspace),
      {
        label: "Get PDF Page Range",
        prominent_args: ["file_id", "start_page", "end_page"],
        arg_labels: { file_id: "file", start_page: "from", end_page: "to" },
      },
    ),
    buildToolDefinition(
      "smart_split_pdf",
      "Inspect a PDF locally, propose a useful split, create titled sub-PDFs plus index.md, and add a ZIP archive to the current agent exports.",
      withPdfFileIdEnum(smartSplitPdfToolSchema, workspace),
      {
        label: "Smart Split PDF",
        prominent_args: ["file_id", "goal"],
        arg_labels: { file_id: "file", goal: "goal" },
      },
    ),
  ];
}

export function createDocumentAgentClientTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildDocumentAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as
        | "list_pdf_files"
        | "inspect_pdf_file"
        | "get_pdf_page_range"
        | "smart_split_pdf",
    ),
  );
}
