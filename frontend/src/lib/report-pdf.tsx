import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  collectReportAssetUrls,
  preloadReportAssetUrls,
  ReportPdfDocument,
  REPORT_PDF_PAGE_SELECTOR,
} from "../components/ReportPdfDocument";
import type { LocalAttachment } from "../types/report";
import type { WorkspaceReportV1 } from "../types/workspace-contract";

type HtmlToImageModule = typeof import("html-to-image");
type PdfLibModule = typeof import("pdf-lib");

const PDF_PAGE_WIDTH = 792;
const PDF_PAGE_HEIGHT = 612;

export type ReportPdfProgress =
  | { phase: "preparing"; totalPages: number }
  | { phase: "rendering"; currentPage: number; totalPages: number }
  | { phase: "assembling"; totalPages: number };

export async function createReportPdfFile(args: {
  files: LocalAttachment[];
  onProgress?: (progress: ReportPdfProgress) => void;
  report: WorkspaceReportV1;
}): Promise<{ blob: Blob; filename: string }> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Report PDF export is only available in the browser.");
  }
  if (!args.report.slides.length) {
    throw new Error("Add at least one slide to the report before exporting it as a PDF.");
  }

  const host = createHiddenExportHost();
  const root = createRoot(host);

  try {
    args.onProgress?.({
      phase: "preparing",
      totalPages: args.report.slides.length,
    });

    flushSync(() => {
      root.render(
        <ReportPdfDocument
          files={args.files}
          report={args.report}
        />,
      );
    });

    await preloadReportAssetUrls(collectReportAssetUrls(args.report, args.files));
    await waitForBrowserFonts();
    await waitForImages(host);
    await waitForAnimationFrames(2);

    const pages = Array.from(host.querySelectorAll<HTMLElement>(REPORT_PDF_PAGE_SELECTOR));
    if (!pages.length) {
      throw new Error("Unable to render the report pages for PDF export.");
    }

    const [{ toCanvas }, { PDFDocument }] = await Promise.all([
      loadHtmlToImageModule(),
      loadPdfLibModule(),
    ]);
    const pdf = await PDFDocument.create();

    for (const [index, pageElement] of pages.entries()) {
      const bounds = pageElement.getBoundingClientRect();
      const captureWidth = Math.max(pageElement.offsetWidth, Math.ceil(bounds.width), 1);
      const captureHeight = Math.max(pageElement.offsetHeight, Math.ceil(bounds.height), 1);

      args.onProgress?.({
        phase: "rendering",
        currentPage: index + 1,
        totalPages: pages.length,
      });

      const canvas = await toCanvas(pageElement, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        canvasHeight: captureHeight * 2,
        canvasWidth: captureWidth * 2,
        pixelRatio: 2,
        preferredFontFormat: "woff2",
        skipFonts: true,
      });
      const pngBytes = await canvasToPngBytes(canvas);
      const image = await pdf.embedPng(pngBytes);
      const pdfPage = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);

      pdfPage.drawImage(image, {
        height: PDF_PAGE_HEIGHT,
        width: PDF_PAGE_WIDTH,
        x: 0,
        y: 0,
      });
    }

    args.onProgress?.({
      phase: "assembling",
      totalPages: pages.length,
    });

    const pdfBytes = await pdf.save();
    return {
      blob: new Blob([toArrayBuffer(pdfBytes)], { type: "application/pdf" }),
      filename: buildReportPdfFilename(args.report),
    };
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function downloadReportPdf(args: {
  files: LocalAttachment[];
  onProgress?: (progress: ReportPdfProgress) => void;
  report: WorkspaceReportV1;
}): Promise<{ blob: Blob; filename: string }> {
  const file = await createReportPdfFile(args);
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return file;
}

export function buildReportPdfFilename(report: WorkspaceReportV1): string {
  const title = report.title.trim() || report.report_id.trim() || "report";
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 72)
    .replace(/_+$/g, "");
  return `${slug || "report"}.pdf`;
}

function createHiddenExportHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("data-report-pdf-export-host", "true");
  Object.assign(host.style, {
    height: "0",
    left: "-20000px",
    opacity: "0",
    overflow: "hidden",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: "0",
    zIndex: "-1",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);
  return host;
}

async function waitForImages(host: HTMLElement): Promise<void> {
  const images = Array.from(host.querySelectorAll<HTMLImageElement>("img"));
  if (!images.length) {
    return;
  }

  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          const handleDone = () => {
            image.removeEventListener("load", handleDone);
            image.removeEventListener("error", handleDone);
            resolve();
          };

          image.addEventListener("load", handleDone, { once: true });
          image.addEventListener("error", handleDone, { once: true });
        }),
    ),
  );
}

async function waitForBrowserFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document) || !document.fonts) {
    return;
  }

  await document.fonts.ready.catch(() => undefined);
}

async function waitForAnimationFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (!value) {
        reject(new Error("Unable to capture the report page image."));
        return;
      }
      resolve(value);
    }, "image/png");
  });
  return await blobToUint8Array(blob);
}

async function loadHtmlToImageModule(): Promise<HtmlToImageModule> {
  return await import("html-to-image");
}

async function loadPdfLibModule(): Promise<PdfLibModule> {
  return await import("pdf-lib");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the captured page image."));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Unable to read the captured page image."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}
