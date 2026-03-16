import { PDFDocument } from "pdf-lib";

export type PdfPageRange = {
  startPage: number;
  endPage: number;
  pageCount: number;
};

export type ExtractedPdfFile = {
  filename: string;
  mimeType: "application/pdf";
  pageRange: PdfPageRange;
  fileDataBase64: string;
};

export async function inspectPdfBytes(pdfBytes: Uint8Array): Promise<{ pageCount: number }> {
  const document = await PDFDocument.load(pdfBytes);
  return { pageCount: document.getPageCount() };
}

export async function extractPdfPageRangeFromBytes(
  pdfBytes: Uint8Array,
  options: {
    filename: string;
    startPage: number;
    endPage: number;
  },
): Promise<ExtractedPdfFile> {
  const source = await PDFDocument.load(pdfBytes);
  const totalPages = source.getPageCount();
  const { startPage, endPage } = normalizePageRange(options.startPage, options.endPage, totalPages);

  const target = await PDFDocument.create();
  const sourcePageIndexes = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage - 1 + index);
  const copiedPages = await target.copyPages(source, sourcePageIndexes);

  for (const page of copiedPages) {
    target.addPage(page);
  }

  const savedBytes = await target.save();
  return {
    filename: buildSubPdfFilename(options.filename, startPage, endPage),
    mimeType: "application/pdf",
    pageRange: {
      startPage,
      endPage,
      pageCount: copiedPages.length,
    },
    fileDataBase64: uint8ArrayToBase64(savedBytes),
  };
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return encodeBase64(binary);
}

export function buildSubPdfFilename(filename: string, startPage: number, endPage: number): string {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${baseName}__pages_${startPage}-${endPage}.pdf`;
}

type BufferLike = {
  from(input: string, encoding: "binary" | "base64"): {
    toString(encoding: "base64" | "binary"): string;
  };
};

function normalizePageRange(startPage: number, endPage: number, totalPages: number) {
  const safeStart = Math.max(1, Math.trunc(startPage));
  const safeEnd = Math.max(safeStart, Math.trunc(endPage));
  if (safeStart > totalPages || safeEnd > totalPages) {
    throw new Error(`Requested pages ${safeStart}-${safeEnd} exceed the PDF page count (${totalPages}).`);
  }
  return {
    startPage: safeStart,
    endPage: safeEnd,
  };
}

function encodeBase64(binary: string): string {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(binary);
  }
  const buffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (!buffer) {
    throw new Error("No base64 encoder is available in this environment.");
  }
  return buffer.from(binary, "binary").toString("base64");
}

function decodeBase64(base64: string): string {
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return window.atob(base64);
  }
  const buffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (!buffer) {
    throw new Error("No base64 decoder is available in this environment.");
  }
  return buffer.from(base64, "base64").toString("binary");
}
