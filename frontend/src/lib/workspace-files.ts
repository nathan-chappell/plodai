import { parseCsvPreview } from "./csv";
import { parseJsonPreview } from "./json";
import { encodeBytesToBase64 } from "./base64";
import { inspectPdfBytes } from "./pdf";
import type {
  LocalChartableFile,
  LocalDataset,
  LocalJsonFile,
  LocalOtherFile,
  LocalPdfFile,
  LocalWorkspaceFile,
} from "../types/report";

export async function buildWorkspaceFile(file: File): Promise<LocalWorkspaceFile> {
  const extension = getFileExtension(file.name);
  const baseFields = {
    id: crypto.randomUUID(),
    name: file.name,
    extension,
    byte_size: file.size,
    mime_type: file.type || undefined,
  } as const;

  if (extension === "csv") {
    const preview = await parseCsvPreview(file);
    return {
      ...baseFields,
      kind: "csv",
      row_count: preview.rowCount,
      columns: preview.columns,
      numeric_columns: preview.numericColumns,
      sample_rows: preview.sampleRows,
      rows: preview.rows,
      preview_rows: preview.previewRows,
    } satisfies LocalDataset;
  }

  if (extension === "json") {
    const preview = await parseJsonPreview(file);
    return {
      ...baseFields,
      kind: "json",
      row_count: preview.rowCount,
      columns: preview.columns,
      numeric_columns: preview.numericColumns,
      sample_rows: preview.sampleRows,
      rows: preview.rows,
      preview_rows: preview.previewRows,
      json_text: preview.jsonText,
      mime_type: file.type || "application/json",
    } satisfies LocalJsonFile;
  }

  if (extension === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = await inspectPdfBytes(bytes);
    return {
      ...baseFields,
      kind: "pdf",
      page_count: preview.pageCount,
      bytes_base64: encodeBytesToBase64(bytes),
    } satisfies LocalPdfFile;
  }

  return {
    ...baseFields,
    kind: "other",
  } satisfies LocalOtherFile;
}

export function getCsvFiles(files: LocalWorkspaceFile[]): LocalDataset[] {
  return files.filter((file): file is LocalDataset => file.kind === "csv");
}

export function getChartableFiles(files: LocalWorkspaceFile[]): LocalChartableFile[] {
  return files.filter((file): file is LocalChartableFile => file.kind === "csv" || file.kind === "json");
}

export function getPdfFiles(files: LocalWorkspaceFile[]): LocalPdfFile[] {
  return files.filter((file): file is LocalPdfFile => file.kind === "pdf");
}

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) {
    return "";
  }
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function summarizeWorkspaceFiles(
  files: LocalWorkspaceFile[],
  options: { includeSamples?: boolean } = {},
): Array<Record<string, unknown>> {
  const includeSamples = options.includeSamples ?? true;
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    kind: file.kind,
    extension: file.extension,
    byte_size: file.byte_size,
    mime_type: file.mime_type,
    ...(file.kind === "csv" || file.kind === "json"
      ? {
          row_count: file.row_count,
          columns: file.columns,
          numeric_columns: file.numeric_columns,
          sample_rows: includeSamples ? file.sample_rows : [],
        }
      : {}),
    ...(file.kind === "pdf"
      ? {
          page_count: file.page_count,
        }
      : {}),
  }));
}

export function findWorkspaceFile(files: LocalWorkspaceFile[], fileId: string): LocalWorkspaceFile {
  const file = files.find((candidate) => candidate.id === fileId);
  if (!file) {
    throw new Error(`Unknown workspace file: ${fileId}`);
  }
  return file;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) {
    return "";
  }
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const header = columns.map(escapeCsvValue).join(",");
  const body = rows
    .map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

export function rowsToJson(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(rows, null, 2);
}

function escapeCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
