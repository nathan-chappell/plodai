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
  createBrokeredCapabilityTool,
  isObjectSchema,
} from "../shared/tool-helpers";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

function pdfFileIds(workspace: CapabilityWorkspaceContext): string[] {
  return workspace.files
    .filter((file) => file.kind === "pdf")
    .map((file) => file.id);
}

function withPdfFileIdEnum(
  schema: JsonSchema,
  workspace: CapabilityWorkspaceContext,
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

export function buildPdfAgentClientToolCatalog(
  workspace: CapabilityWorkspaceContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_pdf_files",
      "List PDF files from the shared workspace, including lightweight metadata and tiny familiarization samples when requested.",
      includeSamplesSchema,
    ),
    buildToolDefinition(
      "inspect_pdf_file",
      "Inspect a PDF locally, returning page count, outline or bookmark hints, and page-level structure summaries.",
      withPdfFileIdEnum(inspectPdfFileToolSchema, workspace),
    ),
    buildToolDefinition(
      "get_pdf_page_range",
      "Extract an inclusive page range from a PDF file, add the derived sub-PDF at an explicit workspace path, and return it as a file input payload.",
      withPdfFileIdEnum(getPdfPageRangeToolSchema, workspace),
    ),
    buildToolDefinition(
      "smart_split_pdf",
      "Inspect a PDF locally, propose a useful split, create titled sub-PDFs plus index.md, and add a ZIP archive at explicit workspace paths.",
      withPdfFileIdEnum(smartSplitPdfToolSchema, workspace),
    ),
  ];
}

export function createPdfAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return buildPdfAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredCapabilityTool(
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
