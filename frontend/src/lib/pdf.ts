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

export type PdfInspectionPage = {
  pageNumber: number;
  titleCandidate: string;
  summary: string;
};

export type PdfInspection = {
  pageCount: number;
  outline: string[];
  pageHints: PdfInspectionPage[];
};

export type SmartSplitPlanEntry = {
  title: string;
  startPage: number;
  endPage: number;
};

export type SmartSplitResult = {
  plan: SmartSplitPlanEntry[];
  indexMarkdown: string;
  extractedFiles: Array<ExtractedPdfFile & { title: string }>;
  archiveName: string;
  archiveBase64: string;
};

export async function inspectPdfBytes(
  pdfBytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<PdfInspection> {
  const document = await PDFDocument.load(pdfBytes);
  const pageCount = document.getPageCount();
  const inspectedPages = await inspectPdfText(pdfBytes, Math.min(pageCount, options.maxPages ?? 8));
  return {
    pageCount,
    outline: inspectedPages.outline,
    pageHints: inspectedPages.pageHints,
  };
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

export async function smartSplitPdfBytes(
  pdfBytes: Uint8Array,
  options: {
    filename: string;
    goal?: string;
  },
): Promise<SmartSplitResult> {
  const inspection = await inspectPdfBytes(pdfBytes, { maxPages: 12 });
  const plan = buildSmartSplitPlan(inspection, options.goal);
  const extractedFiles: Array<ExtractedPdfFile & { title: string }> = [];
  for (const entry of plan) {
    const extracted = await extractPdfPageRangeFromBytes(pdfBytes, {
      filename: buildSmartSplitFilename(options.filename, entry.title, entry.startPage, entry.endPage),
      startPage: entry.startPage,
      endPage: entry.endPage,
    });
    extractedFiles.push({
      ...extracted,
      title: entry.title,
    });
  }
  const indexMarkdown = buildSmartSplitIndexMarkdown(options.filename, inspection, plan);
  const archiveName = buildSmartSplitArchiveName(options.filename);
  const archiveBase64 = await buildZipArchive(
    archiveName,
    indexMarkdown,
    extractedFiles.map((file) => ({
      filename: file.filename,
      base64: file.fileDataBase64,
    })),
  );

  return {
    plan,
    indexMarkdown,
    extractedFiles,
    archiveName,
    archiveBase64,
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

async function inspectPdfText(
  pdfBytes: Uint8Array,
  maxPages: number,
): Promise<{ outline: string[]; pageHints: PdfInspectionPage[] }> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: pdfBytes,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const document = await loadingTask.promise;
    const outline = await loadOutlineTitles(document);
    const pageHints: PdfInspectionPage[] = [];
    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item: { str?: unknown }) => String(item.str ?? ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pageHints.push({
        pageNumber: pageIndex,
        titleCandidate: inferTitleCandidate(text, pageIndex),
        summary: text.slice(0, 220),
      });
    }
    return { outline, pageHints };
  } catch {
    return {
      outline: [],
      pageHints: Array.from({ length: maxPages }, (_, index) => ({
        pageNumber: index + 1,
        titleCandidate: `Section ${index + 1}`,
        summary: "",
      })),
    };
  }
}

async function loadOutlineTitles(document: {
  getOutline: () => Promise<Array<{ title?: string }> | null>;
}): Promise<string[]> {
  const outline = await document.getOutline();
  if (!outline) {
    return [];
  }
  return outline
    .map((entry) => String(entry.title ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function inferTitleCandidate(text: string, pageNumber: number): string {
  if (!text) {
    return `Section ${pageNumber}`;
  }
  const firstSentence = text.split(/[.!?]/, 1)[0]?.trim() ?? "";
  if (firstSentence && firstSentence.length <= 80) {
    return firstSentence;
  }
  const firstWords = text.split(/\s+/).slice(0, 8).join(" ").trim();
  return firstWords || `Section ${pageNumber}`;
}

function buildSmartSplitPlan(inspection: PdfInspection, goal?: string): SmartSplitPlanEntry[] {
  const targetChunkSize = inspection.pageCount <= 6 ? 2 : inspection.pageCount <= 15 ? 4 : 6;
  const boundaryPages = new Set<number>();
  for (const pageHint of inspection.pageHints) {
    if (pageHint.titleCandidate && pageHint.titleCandidate !== `Section ${pageHint.pageNumber}`) {
      boundaryPages.add(pageHint.pageNumber);
    }
  }

  const segments: SmartSplitPlanEntry[] = [];
  let startPage = 1;
  while (startPage <= inspection.pageCount) {
    let endPage = Math.min(inspection.pageCount, startPage + targetChunkSize - 1);
    for (let candidate = endPage; candidate > startPage; candidate -= 1) {
      if (boundaryPages.has(candidate + 1)) {
        endPage = candidate;
        break;
      }
    }
    const startHint =
      inspection.pageHints.find((pageHint) => pageHint.pageNumber === startPage)?.titleCandidate ||
      `Section ${segments.length + 1}`;
    const goalPrefix = goal?.trim() ? `${goal.trim()}: ` : "";
    segments.push({
      title: `${goalPrefix}${startHint}`.slice(0, 96),
      startPage,
      endPage,
    });
    startPage = endPage + 1;
  }
  return segments;
}

function buildSmartSplitIndexMarkdown(
  filename: string,
  inspection: PdfInspection,
  plan: SmartSplitPlanEntry[],
): string {
  const lines = [
    `# Smart split for ${filename}`,
    "",
    `Original page count: ${inspection.pageCount}`,
    "",
    "## Outputs",
    "",
    ...plan.map(
      (entry, index) =>
        `${index + 1}. **${entry.title}** - pages ${entry.startPage}-${entry.endPage}`,
    ),
  ];
  if (inspection.outline.length) {
    lines.push("", "## Outline hints", "", ...inspection.outline.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function buildSmartSplitFilename(filename: string, title: string, startPage: number, endPage: number): string {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${baseName}__${slug || "section"}__pages_${startPage}-${endPage}.pdf`;
}

function buildSmartSplitArchiveName(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${baseName}__smart_split.zip`;
}

async function buildZipArchive(
  archiveName: string,
  indexMarkdown: string,
  files: Array<{ filename: string; base64: string }>,
): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("index.md", indexMarkdown);
  for (const file of files) {
    zip.file(file.filename, base64ToUint8Array(file.base64));
  }
  const archiveBytes = await zip.generateAsync({ type: "uint8array" });
  void archiveName;
  return uint8ArrayToBase64(archiveBytes);
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
