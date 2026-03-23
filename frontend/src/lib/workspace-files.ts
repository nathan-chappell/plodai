import { parseCsvPreview } from "./csv";
import { parseJsonPreview } from "./json";
import { encodeBytesToBase64 } from "./base64";
import {
  isImageExtension,
  isImageMimeType,
  normalizeImageMimeType,
  readImageDimensionsFromFile,
} from "./image";
import { inspectPdfBytes } from "./pdf";
import type {
  LocalDataset,
  LocalImageAttachment,
  LocalOtherAttachment,
  LocalPdfAttachment,
  LocalAttachment,
} from "../types/report";
import type { StoredFilePreview } from "../types/stored-file";

export async function buildWorkspaceFile(
  file: File,
  options?: {
    id?: string;
  },
): Promise<LocalAttachment> {
  const extension = getFileExtension(file.name);
  const baseFields = {
    id: options?.id ?? crypto.randomUUID(),
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
    } satisfies LocalDataset;
  }

  if (extension === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = await inspectPdfBytes(bytes);
    return {
      ...baseFields,
      kind: "pdf",
      page_count: preview.pageCount,
      bytes_base64: encodeBytesToBase64(bytes),
    } satisfies LocalPdfAttachment;
  }

  if (isImageExtension(extension) || isImageMimeType(file.type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = await readImageDimensionsFromFile(file);
    return {
      ...baseFields,
      kind: "image",
      mime_type: normalizeImageMimeType(file.type, extension),
      width: dimensions.width,
      height: dimensions.height,
      bytes_base64: encodeBytesToBase64(bytes),
    } satisfies LocalImageAttachment;
  }

  return {
    ...baseFields,
    kind: "other",
  } satisfies LocalOtherAttachment;
}

export async function buildStoredFilePreviewFromFile(
  file: File,
): Promise<StoredFilePreview> {
  const extension = getFileExtension(file.name);

  if (extension === "csv") {
    const preview = await parseCsvPreview(file);
    return {
      kind: "dataset",
      row_count: preview.rowCount,
      columns: preview.columns,
      numeric_columns: preview.numericColumns,
    };
  }

  if (extension === "json") {
    const preview = await parseJsonPreview(file);
    return {
      kind: "dataset",
      row_count: preview.rowCount,
      columns: preview.columns,
      numeric_columns: preview.numericColumns,
    };
  }

  if (extension === "pdf") {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = await inspectPdfBytes(bytes);
      return {
        kind: "pdf",
        page_count: preview.pageCount,
      };
    } catch {
      return {
        kind: "empty",
      };
    }
  }

  if (isImageExtension(extension) || isImageMimeType(file.type)) {
    try {
      const dimensions = await readImageDimensionsFromFile(file);
      return {
        kind: "image",
        width: dimensions.width,
        height: dimensions.height,
      };
    } catch {
      return {
        kind: "empty",
      };
    }
  }

  return {
    kind: "empty",
  };
}

export function getDatasets(files: LocalAttachment[]): LocalDataset[] {
  return files.filter(
    (file): file is LocalDataset => file.kind === "csv" || file.kind === "json",
  );
}

export function getCsvDatasets(files: LocalAttachment[]): LocalDataset[] {
  return files.filter((file): file is LocalDataset => file.kind === "csv");
}

export function getPdfFiles(files: LocalAttachment[]): LocalPdfAttachment[] {
  return files.filter((file): file is LocalPdfAttachment => file.kind === "pdf");
}

export function getImageFiles(files: LocalAttachment[]): LocalImageAttachment[] {
  return files.filter((file): file is LocalImageAttachment => file.kind === "image");
}

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) {
    return "";
  }
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function summarizeWorkspaceFiles(
  files: LocalAttachment[],
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
    ...(file.kind === "image"
      ? {
          width: file.width,
          height: file.height,
        }
      : {}),
  }));
}

export function findWorkspaceFile(files: LocalAttachment[], fileId: string): LocalAttachment {
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
