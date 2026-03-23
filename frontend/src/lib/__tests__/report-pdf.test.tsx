// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawImageMock = vi.fn();
const addPageMock = vi.fn(() => ({ drawImage: drawImageMock }));
const embedPngMock = vi.fn(async () => ({ width: 1056, height: 816 }));
const saveMock = vi.fn(async () => new Uint8Array([1, 2, 3]));
const pdfDocumentCreateMock = vi.fn(async () => ({
  addPage: addPageMock,
  embedPng: embedPngMock,
  save: saveMock,
}));
const toCanvasMock = vi.fn(async () => {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "width", { configurable: true, value: 1056, writable: true });
  Object.defineProperty(canvas, "height", { configurable: true, value: 816, writable: true });
  Object.defineProperty(canvas, "toBlob", {
    configurable: true,
    value: (callback: BlobCallback | null) => {
      callback?.(new Blob(["png"], { type: "image/png" }));
    },
  });
  return canvas;
});

vi.mock("html-to-image", () => ({
  toCanvas: toCanvasMock,
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: pdfDocumentCreateMock,
  },
}));

import {
  buildReportPdfFilename,
  createReportPdfFile,
  downloadReportPdf,
} from "../report-pdf";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

function buildReport(slideCount = 1): WorkspaceReportV1 {
  return {
    version: "v1",
    report_id: "report-1",
    title: "Board report",
    created_at: "2026-03-20T09:00:00.000Z",
    updated_at: "2026-03-20T10:05:00.000Z",
    slides: Array.from({ length: slideCount }, (_, index) => ({
      id: `slide-${index + 1}`,
      created_at: `2026-03-20T10:0${index}:00.000Z`,
      title: `Slide ${index + 1}`,
      layout: "1x1",
      panels: [
        {
          id: `panel-${index + 1}`,
          type: "narrative",
          title: "Summary",
          markdown: "West region revenue leads the pack.",
        },
      ],
    })),
  };
}

describe("report PDF export", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let originalCreateObjectUrl: typeof URL.createObjectURL;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;

  beforeEach(() => {
    toCanvasMock.mockClear();
    drawImageMock.mockClear();
    addPageMock.mockClear();
    embedPngMock.mockClear();
    saveMock.mockClear();
    pdfDocumentCreateMock.mockClear();

    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    originalRequestAnimationFrame = window.requestAnimationFrame;

    vi.useFakeTimers();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:report-pdf"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds predictable report PDF filenames", () => {
    expect(buildReportPdfFilename(buildReport())).toBe("board_report.pdf");
  });

  it("renders each slide into a PDF blob and cleans up the hidden export host", async () => {
    const onProgress = vi.fn();

    const filePromise = createReportPdfFile({
      files: [],
      onProgress,
      report: buildReport(2),
    });

    await vi.runAllTimersAsync();
    const file = await filePromise;

    expect(file.filename).toBe("board_report.pdf");
    expect(file.blob.type).toBe("application/pdf");
    expect(pdfDocumentCreateMock).toHaveBeenCalledTimes(1);
    expect(toCanvasMock).toHaveBeenCalledTimes(2);
    expect(toCanvasMock).toHaveBeenNthCalledWith(
      1,
      expect.any(HTMLElement),
      expect.objectContaining({
        preferredFontFormat: "woff2",
        skipFonts: true,
      }),
    );
    expect(addPageMock).toHaveBeenCalledTimes(2);
    expect(drawImageMock).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: "preparing",
      totalPages: 2,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      phase: "assembling",
      totalPages: 2,
    });
    expect(document.querySelector("[data-report-pdf-export-host='true']")).toBeNull();
  });

  it("downloads the generated PDF blob without opening another window", async () => {
    const downloadPromise = downloadReportPdf({
      files: [],
      report: buildReport(),
    });

    await vi.runAllTimersAsync();
    const file = await downloadPromise;
    await vi.runAllTimersAsync();

    expect(file.filename).toBe("board_report.pdf");
    expect(URL.createObjectURL).toHaveBeenCalledWith(file.blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report-pdf");
  });
});
