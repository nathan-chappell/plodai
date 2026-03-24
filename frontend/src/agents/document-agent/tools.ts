import { parseCsvText } from "../../lib/csv";
import { parseJsonText } from "../../lib/json";
import {
  appendDatasetAppendixToPdfBytes,
  base64ToUint8Array,
  fillDocumentFormInPdfBytes,
  inspectDocumentPdfBytes,
  mergePdfBytes,
  replaceDocumentTextInPdfBytes,
  smartSplitPdfBytes,
} from "../../lib/pdf";
import {
  deleteDocumentFile,
  fetchStoredFileBlob,
  listDocumentFiles,
  uploadStoredFile,
} from "../../lib/api";
import { buildStoredFilePreviewFromFile } from "../../lib/workspace-files";
import type {
  AppendDocumentAppendixFromDatasetToolArgs,
  DeleteDocumentFileToolArgs,
  FillDocumentFormToolArgs,
  InspectDocumentFileToolArgs,
  ListDocumentFilesToolArgs,
  MergeDocumentFilesToolArgs,
  MergeDocumentSourceInput,
  ReplaceDocumentTextToolArgs,
  SmartSplitDocumentToolArgs,
  SmartSplitEntry,
} from "../../types/analysis";
import type { JsonSchema } from "../../types/json-schema";
import type {
  DocumentEditResult,
  DocumentFileSummary,
  DocumentInspectionResult,
  DocumentMergeResult,
  DocumentSmartSplitResult,
  DocumentSplitEntry,
  StoredFilePreview,
} from "../../types/stored-file";
import { buildToolDefinition } from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

const emptyObjectSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const documentFileIdSchema: JsonSchema = {
  type: "string",
};

const locatorIdSchema: JsonSchema = {
  type: "string",
};

const renderAsSchema: JsonSchema = {
  enum: ["table", "chart"],
};

const documentFieldValueSchema: JsonSchema = {
  type: "object",
  properties: {
    locator_id: { type: "string" },
    value: { type: "string" },
  },
  required: ["locator_id", "value"],
  additionalProperties: false,
};

const documentMergeSourceSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: documentFileIdSchema,
    start_page: { type: "integer", minimum: 1 },
    end_page: { type: "integer", minimum: 1 },
  },
  required: ["file_id"],
  additionalProperties: false,
};

export function buildDocumentAgentClientToolCatalog(
  _workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_document_files",
      "List thread-scoped document files available to the documents agent.",
      emptyObjectSchema,
      { label: "List Document Files" },
    ),
    buildToolDefinition(
      "inspect_document_file",
      "Inspect a stored PDF and return stable locator ids for text regions and form fields.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          max_pages: { type: "integer", minimum: 1, maximum: 30 },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Inspect Document",
        prominent_args: ["file_id", "max_pages"],
        arg_labels: { file_id: "file", max_pages: "max" },
      },
    ),
    buildToolDefinition(
      "replace_document_text",
      "Replace a text region in a PDF by locator id, using strict safe fallbacks when in-place replacement is not reliable.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          locator_id: locatorIdSchema,
          replacement_text: { type: "string" },
        },
        required: ["file_id", "locator_id", "replacement_text"],
        additionalProperties: false,
      },
      {
        label: "Replace Document Text",
        prominent_args: ["file_id", "locator_id"],
        arg_labels: { file_id: "file", locator_id: "locator" },
      },
    ),
    buildToolDefinition(
      "fill_document_form",
      "Fill PDF form fields by discovered locator id and report unresolved field locators explicitly.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          field_values: {
            type: "array",
            items: documentFieldValueSchema,
          },
        },
        required: ["file_id", "field_values"],
        additionalProperties: false,
      },
      {
        label: "Fill Document Form",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "file" },
      },
    ),
    buildToolDefinition(
      "append_document_appendix_from_dataset",
      "Append a table or chart appendix generated from a thread-scoped dataset file.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          dataset_file_id: documentFileIdSchema,
          title: { type: "string" },
          render_as: renderAsSchema,
        },
        required: ["file_id", "dataset_file_id", "title"],
        additionalProperties: false,
      },
      {
        label: "Append Dataset Appendix",
        prominent_args: ["file_id", "dataset_file_id"],
        arg_labels: { file_id: "file", dataset_file_id: "dataset" },
      },
    ),
    buildToolDefinition(
      "merge_document_files",
      "Merge two or more stored PDFs, optionally using page ranges, into a new derived PDF in the current document thread.",
      {
        type: "object",
        properties: {
          sources: {
            type: "array",
            minItems: 2,
            items: documentMergeSourceSchema,
          },
          output_name: { type: "string" },
        },
        required: ["sources"],
        additionalProperties: false,
      },
      {
        label: "Merge Document Files",
        prominent_args: ["output_name"],
        arg_labels: { output_name: "name" },
      },
    ),
    buildToolDefinition(
      "smart_split_document",
      "Split a PDF into useful derived files, plus an index and ZIP bundle, all stored in the current document thread.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
          goal: { type: "string" },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Smart Split Document",
        prominent_args: ["file_id", "goal"],
        arg_labels: { file_id: "file", goal: "goal" },
      },
    ),
    buildToolDefinition(
      "delete_document_file",
      "Delete a thread-scoped document file from the current document thread.",
      {
        type: "object",
        properties: {
          file_id: documentFileIdSchema,
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      {
        label: "Delete Document File",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "file" },
      },
    ),
  ];
}

export function createDocumentAgentClientTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  const catalog = buildDocumentAgentClientToolCatalog(workspace);

  return [
    bindDocumentTool<ListDocumentFilesToolArgs, { thread_id: string | null; files: DocumentFileSummary[] }>(
      catalog,
      "list_document_files",
      async () => {
        const threadId = workspace.activeThreadId ?? null;
        if (!threadId) {
          return {
            thread_id: null,
            files: [],
          };
        }
        const response = await listDocumentFiles(threadId);
        return {
          thread_id: response.thread_id,
          files: response.files,
        };
      },
    ),
    bindDocumentTool<InspectDocumentFileToolArgs, DocumentInspectionResult>(
      catalog,
      "inspect_document_file",
      async (args) => {
        const file = await requireDocumentFileSummary(workspace, args.file_id);
        ensurePdfFile(file);
        const bytes = await loadStoredFileBytes(file.id);
        const inspection = await inspectDocumentPdfBytes(bytes, {
          maxPages: args.max_pages ?? 30,
        });
        return {
          file,
          page_count: inspection.pageCount,
          locators: inspection.locators,
          page_summaries: inspection.pageSummaries,
        };
      },
    ),
    bindDocumentTool<ReplaceDocumentTextToolArgs, DocumentEditResult>(
      catalog,
      "replace_document_text",
      async (args) => {
        const file = await requireDocumentFileSummary(workspace, args.file_id);
        ensurePdfFile(file);
        const bytes = await loadStoredFileBytes(file.id);
        const inspection = await inspectDocumentPdfBytes(bytes);
        const replacement = await replaceDocumentTextInPdfBytes(bytes, inspection, {
          locatorId: args.locator_id,
          replacementText: args.replacement_text,
        });
        const derivedFile = await uploadDerivedDocumentFile(workspace, {
          file: buildDerivedBinaryFile(
            buildDerivedFilename(file.name, replacement.strategyUsed),
            replacement.pdfBytes,
            "application/pdf",
          ),
          parentFileId: file.id,
          previewJson: {
            kind: "pdf",
            page_count: file.preview.kind === "pdf" ? file.preview.page_count : inspection.pageCount,
          },
        });
        return {
          file: derivedFile,
          parent_file_id: file.id,
          strategy_used: replacement.strategyUsed,
          message: "Created a new PDF revision with the requested text replacement.",
          warning: replacement.warning ?? null,
          unresolved_locator_ids: [],
        };
      },
    ),
    bindDocumentTool<FillDocumentFormToolArgs, DocumentEditResult>(
      catalog,
      "fill_document_form",
      async (args) => {
        const file = await requireDocumentFileSummary(workspace, args.file_id);
        ensurePdfFile(file);
        const bytes = await loadStoredFileBytes(file.id);
        const inspection = await inspectDocumentPdfBytes(bytes);
        const filled = await fillDocumentFormInPdfBytes(bytes, inspection, args.field_values);
        if (filled.resolvedCount === 0) {
          throw new Error(
            filled.warning ??
              "None of the requested form fields could be resolved safely.",
          );
        }
        const derivedFile = await uploadDerivedDocumentFile(workspace, {
          file: buildDerivedBinaryFile(
            buildDerivedFilename(file.name, "form_fill"),
            filled.pdfBytes,
            "application/pdf",
          ),
          parentFileId: file.id,
          previewJson: {
            kind: "pdf",
            page_count: file.preview.kind === "pdf" ? file.preview.page_count : inspection.pageCount,
          },
        });
        return {
          file: derivedFile,
          parent_file_id: file.id,
          strategy_used: "form_fill",
          message: `Filled ${filled.resolvedCount} form field locator${filled.resolvedCount === 1 ? "" : "s"} and created a new PDF revision.`,
          warning: buildUnresolvedWarning(filled.unresolvedLocatorIds, filled.warning),
          unresolved_locator_ids: filled.unresolvedLocatorIds,
        };
      },
    ),
    bindDocumentTool<AppendDocumentAppendixFromDatasetToolArgs, DocumentEditResult>(
      catalog,
      "append_document_appendix_from_dataset",
      async (args) => {
        const sourceFile = await requireDocumentFileSummary(workspace, args.file_id);
        ensurePdfFile(sourceFile);
        const datasetFile = await requireDocumentFileSummary(workspace, args.dataset_file_id);
        ensureDatasetFile(datasetFile);
        const sourceBytes = await loadStoredFileBytes(sourceFile.id);
        const datasetRows = await loadDatasetRows(datasetFile);
        const appendix = await appendDatasetAppendixToPdfBytes(sourceBytes, {
          title: args.title,
          rows: datasetRows,
          renderAs: args.render_as ?? "table",
        });
        const derivedFile = await uploadDerivedDocumentFile(workspace, {
          file: buildDerivedBinaryFile(
            buildDerivedFilename(sourceFile.name, "appendix"),
            appendix.pdfBytes,
            "application/pdf",
          ),
          parentFileId: sourceFile.id,
          previewJson: await buildPdfPreviewFromBytes(appendix.pdfBytes),
        });
        return {
          file: derivedFile,
          parent_file_id: sourceFile.id,
          strategy_used: "appendix_append",
          message: `Appended a ${args.render_as ?? "table"} appendix generated from ${datasetFile.name}.`,
          warning: appendix.warning ?? null,
          unresolved_locator_ids: [],
        };
      },
    ),
    bindDocumentTool<MergeDocumentFilesToolArgs, DocumentMergeResult>(
      catalog,
      "merge_document_files",
      async (args) => {
        const sourceInputs = normalizeMergeSourceInputs(args.sources);
        const files = await listCurrentDocumentFiles(workspace);
        const filesById = new Map(files.map((file) => [file.id, file] as const));
        const bytesByFileId = new Map<string, Promise<Uint8Array>>();

        const mergeSources = await Promise.all(
          sourceInputs.map(async (source) => {
            const file = filesById.get(source.file_id);
            if (!file) {
              throw new Error(`Unknown document thread file: ${source.file_id}`);
            }
            ensurePdfFile(file);
            let bytesPromise = bytesByFileId.get(file.id);
            if (!bytesPromise) {
              bytesPromise = loadStoredFileBytes(file.id);
              bytesByFileId.set(file.id, bytesPromise);
            }
            return {
              file,
              fileId: file.id,
              pdfBytes: await bytesPromise,
              startPage: source.start_page,
              endPage: source.end_page,
            };
          }),
        );

        const merged = await mergePdfBytes(
          mergeSources.map((source) => ({
            fileId: source.fileId,
            pdfBytes: source.pdfBytes,
            startPage: source.startPage,
            endPage: source.endPage,
          })),
        );
        const firstSource = mergeSources[0];
        const mergedFilename = buildMergedFilename(
          firstSource.file.name,
          mergeSources.length,
          args.output_name,
        );
        const derivedFile = await uploadDerivedDocumentFile(workspace, {
          file: buildDerivedBinaryFile(
            mergedFilename,
            merged.pdfBytes,
            "application/pdf",
          ),
          parentFileId: firstSource.file.id,
          previewJson: {
            kind: "pdf",
            page_count: merged.pageCount,
          },
        });

        return {
          file: derivedFile,
          source_file_ids: mergeSources.map((source) => source.file.id),
          source_ranges: merged.sourceRanges,
          message: `Merged ${mergeSources.length} PDF selection${mergeSources.length === 1 ? "" : "s"} into ${derivedFile.name}.`,
        };
      },
    ),
    bindDocumentTool<SmartSplitDocumentToolArgs, DocumentSmartSplitResult>(
      catalog,
      "smart_split_document",
      async (args, context) => {
        const sourceFile = await requireDocumentFileSummary(workspace, args.file_id);
        ensurePdfFile(sourceFile);
        const bytes = await loadStoredFileBytes(sourceFile.id);
        const split = await smartSplitPdfBytes(bytes, {
          filename: sourceFile.name,
          goal: args.goal,
        });

        const entries: DocumentSplitEntry[] = [];
        const effectEntries: SmartSplitEntry[] = [];
        for (const extractedFile of split.extractedFiles) {
          const derivedPdf = buildDerivedBinaryFile(
            extractedFile.filename,
            base64ToUint8Array(extractedFile.fileDataBase64),
            "application/pdf",
          );
          const storedEntryFile = await uploadDerivedDocumentFile(workspace, {
            file: derivedPdf,
            parentFileId: sourceFile.id,
            previewJson: {
              kind: "pdf",
              page_count: extractedFile.pageRange.pageCount,
            },
          });
          const entry: DocumentSplitEntry = {
            file: storedEntryFile,
            title: extractedFile.title,
            start_page: extractedFile.pageRange.startPage,
            end_page: extractedFile.pageRange.endPage,
            page_count: extractedFile.pageRange.pageCount,
          };
          entries.push(entry);
          effectEntries.push({
            fileId: storedEntryFile.id,
            name: storedEntryFile.name,
            title: extractedFile.title,
            startPage: extractedFile.pageRange.startPage,
            endPage: extractedFile.pageRange.endPage,
            pageCount: extractedFile.pageRange.pageCount,
          });
        }

        const indexFile = await uploadDerivedDocumentFile(workspace, {
          file: new File(
            [split.indexMarkdown],
            buildDerivedFilename(sourceFile.name, "smart_split_index", "md"),
            { type: "text/markdown" },
          ),
          parentFileId: sourceFile.id,
          previewJson: {
            kind: "empty",
          },
        });
        const archiveFile = await uploadDerivedDocumentFile(workspace, {
          file: buildDerivedBinaryFile(
            split.archiveName,
            base64ToUint8Array(split.archiveBase64),
            "application/zip",
          ),
          parentFileId: sourceFile.id,
          previewJson: {
            kind: "empty",
          },
        });

        context.emitEffect({
          type: "pdf_smart_split_completed",
          sourceFileId: sourceFile.id,
          sourceFileName: sourceFile.name,
          archiveFileId: archiveFile.id,
          archiveFileName: archiveFile.name,
          indexFileId: indexFile.id,
          indexFileName: indexFile.name,
          entries: effectEntries,
          markdown: split.indexMarkdown,
        });

        return {
          source_file: sourceFile,
          archive_file: archiveFile,
          index_file: indexFile,
          entries,
          markdown: split.indexMarkdown,
        };
      },
    ),
    bindDocumentTool<DeleteDocumentFileToolArgs, { thread_id: string; file_id: string; deleted: boolean }>(
      catalog,
      "delete_document_file",
      async (args) => {
        const threadId = requireActiveThreadId(workspace);
        return await deleteDocumentFile(threadId, args.file_id);
      },
    ),
  ];
}

function bindDocumentTool<Args, Result>(
  catalog: FunctionToolDefinition[],
  name: string,
  handler: AgentClientTool<Args, Result>["handler"],
): AgentClientTool {
  const definition = catalog.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Unknown document tool definition: ${name}`);
  }
  return {
    ...definition,
    handler: handler as AgentClientTool["handler"],
  };
}

function requireActiveThreadId(workspace: AgentRuntimeContext): string {
  const threadId = workspace.activeThreadId ?? null;
  if (!threadId) {
    throw new Error("No active document thread exists yet. Upload or import a PDF first.");
  }
  return threadId;
}

async function listCurrentDocumentFiles(
  workspace: AgentRuntimeContext,
): Promise<DocumentFileSummary[]> {
  const threadId = requireActiveThreadId(workspace);
  const response = await listDocumentFiles(threadId);
  return response.files;
}

async function requireDocumentFileSummary(
  workspace: AgentRuntimeContext,
  fileId: string,
): Promise<DocumentFileSummary> {
  const files = await listCurrentDocumentFiles(workspace);
  const file = files.find((candidate) => candidate.id === fileId);
  if (!file) {
    throw new Error(`Unknown document thread file: ${fileId}`);
  }
  return file;
}

function ensurePdfFile(file: DocumentFileSummary): void {
  if (file.kind !== "pdf") {
    throw new Error(`Document file ${file.name} is not a PDF.`);
  }
}

function ensureDatasetFile(file: DocumentFileSummary): void {
  if (file.kind !== "csv" && file.kind !== "json") {
    throw new Error(`Document file ${file.name} is not a CSV or JSON dataset.`);
  }
}

async function loadStoredFileBytes(fileId: string): Promise<Uint8Array> {
  const blob = await fetchStoredFileBlob(fileId);
  return new Uint8Array(await blob.arrayBuffer());
}

async function loadDatasetRows(file: DocumentFileSummary) {
  const blob = await fetchStoredFileBlob(file.id);
  const text = await blob.text();
  if (file.kind === "json") {
    return parseJsonText(text).rows;
  }
  const parsed = parseCsvText(text);
  const numericColumns =
    file.preview.kind === "dataset" ? new Set(file.preview.numeric_columns) : new Set<string>();
  return parsed.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        numericColumns.has(key) && typeof value === "string" && value.trim()
          ? Number(value)
          : value,
      ]),
    ),
  );
}

async function uploadDerivedDocumentFile(
  workspace: AgentRuntimeContext,
  options: {
    file: File;
    parentFileId: string;
    previewJson?: StoredFilePreview | null;
  },
): Promise<DocumentFileSummary> {
  const previewJson =
    options.previewJson ?? (await buildStoredFilePreviewFromFile(options.file));
  const response = await uploadStoredFile({
    file: options.file,
    workspaceId: workspace.workspaceId,
    appId: "documents",
    scope: "document_thread_file",
    threadId: requireActiveThreadId(workspace),
    createAttachment: false,
    sourceKind: "derived",
    parentFileId: options.parentFileId,
    previewJson,
  });
  return response.stored_file as DocumentFileSummary;
}

function buildDerivedFilename(
  filename: string,
  suffix: string,
  extensionOverride?: string,
): string {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension =
    extensionOverride ??
    (dotIndex > 0 && dotIndex < filename.length - 1 ? filename.slice(dotIndex + 1) : "");
  return extension ? `${baseName}__${suffix}.${extension}` : `${baseName}__${suffix}`;
}

function buildMergedFilename(
  filename: string,
  sourceCount: number,
  outputName?: string,
): string {
  const trimmedOutputName = outputName?.trim() ?? "";
  if (!trimmedOutputName) {
    return buildDerivedFilename(filename, `merged_${sourceCount}_files`);
  }
  return /\.pdf$/i.test(trimmedOutputName)
    ? trimmedOutputName
    : `${trimmedOutputName}.pdf`;
}

function buildDerivedBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): File {
  const normalizedBuffer = new Uint8Array(bytes).buffer;
  return new File([normalizedBuffer], filename, { type: mimeType });
}

async function buildPdfPreviewFromBytes(bytes: Uint8Array): Promise<StoredFilePreview> {
  const previewFile = buildDerivedBinaryFile("preview.pdf", bytes, "application/pdf");
  return await buildStoredFilePreviewFromFile(previewFile);
}

function buildUnresolvedWarning(
  unresolvedLocatorIds: string[],
  warning?: string,
): string | null {
  if (warning) {
    return warning;
  }
  if (!unresolvedLocatorIds.length) {
    return null;
  }
  return `Left ${unresolvedLocatorIds.length} locator${unresolvedLocatorIds.length === 1 ? "" : "s"} unresolved.`;
}

function normalizeMergeSourceInputs(
  sources: MergeDocumentSourceInput[],
): MergeDocumentSourceInput[] {
  if (sources.length < 2) {
    throw new Error("Select at least two PDF sources to merge.");
  }

  return sources.map((source, index) => {
    const fileId = source.file_id.trim();
    if (!fileId) {
      throw new Error(`Source ${index + 1} is missing a file_id.`);
    }
    const hasStartPage = source.start_page != null;
    const hasEndPage = source.end_page != null;
    if (hasStartPage !== hasEndPage) {
      throw new Error(
        `Source ${index + 1} (${fileId}) must include both start_page and end_page or neither.`,
      );
    }
    return {
      ...source,
      file_id: fileId,
    };
  });
}
