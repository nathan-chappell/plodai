import { encodeBytesToBase64 } from "../../lib/base64";
import { parseCsvText } from "../../lib/csv";
import { getFileExtension, buildWorkspaceFile } from "../../lib/workspace-files";
import { parseJsonText } from "../../lib/json";
import { normalizeImageMimeType } from "../../lib/image";
import type {
  LocalDataset,
  LocalImageFile,
  LocalPdfFile,
} from "../../types/report";

export function buildCsvTourFile(id: string, name: string, csvText: string): LocalDataset {
  const preview = parseCsvText(csvText);
  return {
    id,
    name,
    kind: "csv",
    extension: "csv",
    byte_size: new TextEncoder().encode(csvText).length,
    mime_type: "text/csv",
    row_count: preview.rowCount,
    columns: preview.columns,
    numeric_columns: preview.numericColumns,
    sample_rows: preview.sampleRows,
    rows: preview.rows,
    preview_rows: preview.previewRows,
  };
}

export function buildJsonTourFile(id: string, name: string, jsonText: string): LocalDataset {
  const preview = parseJsonText(jsonText);
  return {
    id,
    name,
    kind: "json",
    extension: "json",
    byte_size: new TextEncoder().encode(jsonText).length,
    mime_type: "application/json",
    row_count: preview.rowCount,
    columns: preview.columns,
    numeric_columns: preview.numericColumns,
    sample_rows: preview.sampleRows,
    rows: preview.rows,
    preview_rows: preview.previewRows,
    json_text: preview.jsonText,
  };
}

export function buildImageTourFile(options: {
  id: string;
  name: string;
  mime_type: string;
  width: number;
  height: number;
  bytes_base64: string;
}): LocalImageFile {
  return {
    id: options.id,
    name: options.name,
    kind: "image",
    extension: options.name.split(".").at(-1)?.toLowerCase() ?? "png",
    byte_size: Math.floor((options.bytes_base64.length * 3) / 4),
    mime_type: options.mime_type,
    width: options.width,
    height: options.height,
    bytes_base64: options.bytes_base64,
  };
}

export async function buildPublicImageTourFile(options: {
  id: string;
  public_path: string;
  name?: string;
  mime_type?: string;
}): Promise<LocalImageFile> {
  const publicPath = options.public_path.startsWith("/")
    ? options.public_path
    : `/${options.public_path}`;
  const publicUrl = encodeURI(publicPath);
  const response = await fetch(publicUrl);
  if (!response.ok) {
    throw new Error(`Unable to load tour image: ${publicPath}`);
  }

  const filename =
    options.name?.trim() ||
    decodeURIComponent(publicPath.split("/").at(-1) ?? options.id);
  const extension = getFileExtension(filename);
  const blob = await response.blob();
  const file = new File([blob], filename, {
    type:
      options.mime_type?.trim() ||
      blob.type ||
      normalizeImageMimeType(undefined, extension),
  });
  const workspaceFile = await buildWorkspaceFile(file);

  if (workspaceFile.kind !== "image") {
    throw new Error(`Expected tour asset ${publicPath} to resolve to an image file.`);
  }

  return {
    ...workspaceFile,
    id: options.id,
    name: filename,
  };
}

export async function buildPdfTourFile(options: {
  id: string;
  name: string;
  pages: Array<{ title: string; body: string[] }>;
}): Promise<LocalPdfFile> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const titleFont = await document.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);

  for (const pageSpec of options.pages) {
    const page = document.addPage([612, 792]);
    page.drawText(pageSpec.title, {
      x: 56,
      y: 730,
      size: 22,
      font: titleFont,
      color: rgb(0.18, 0.12, 0.08),
    });
    let y = 690;
    for (const line of pageSpec.body) {
      page.drawText(line, {
        x: 56,
        y,
        size: 12,
        font: bodyFont,
        color: rgb(0.24, 0.22, 0.2),
      });
      y -= 24;
    }
  }

  const bytes = await document.save();
  return {
    id: options.id,
    name: options.name,
    kind: "pdf",
    extension: "pdf",
    byte_size: bytes.length,
    mime_type: "application/pdf",
    page_count: options.pages.length,
    bytes_base64: encodeBytesToBase64(bytes),
  };
}
