import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  base64ToUint8Array,
  buildSmartSplitPlan,
  buildSubPdfFilename,
  extractPdfPageRangeFromBytes,
  inspectPdfBytes,
  smartSplitPdfBytes,
} from "../pdf";

async function buildPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([400, 400]);
  }
  return document.save();
}

describe("pdf helpers", () => {
  it("inspects page counts", async () => {
    const bytes = await buildPdf(4);
    await expect(inspectPdfBytes(bytes)).resolves.toMatchObject({ pageCount: 4 });
  });

  it("extracts an inclusive sub-range and returns a reusable base64 payload", async () => {
    const bytes = await buildPdf(5);
    const extracted = await extractPdfPageRangeFromBytes(bytes, {
      filename: "deck.pdf",
      startPage: 2,
      endPage: 4,
    });

    expect(extracted.filename).toBe("deck__pages_2-4.pdf");
    expect(extracted.pageRange).toEqual({
      startPage: 2,
      endPage: 4,
      pageCount: 3,
    });

    const inspected = await inspectPdfBytes(base64ToUint8Array(extracted.fileDataBase64));
    expect(inspected.pageCount).toBe(3);
  });

  it("formats derived filenames predictably", () => {
    expect(buildSubPdfFilename("report.pdf", 1, 2)).toBe("report__pages_1-2.pdf");
    expect(buildSubPdfFilename("report", 3, 7)).toBe("report__pages_3-7.pdf");
  });

  it("builds a smart split result with an index and archive", async () => {
    const bytes = await buildPdf(6);
    const split = await smartSplitPdfBytes(bytes, {
      filename: "deck.pdf",
      goal: "Executive decomposition",
    });

    expect(split.plan.length).toBeGreaterThan(0);
    expect(split.indexMarkdown).toContain("Smart split for deck.pdf");
    expect(split.extractedFiles.length).toBe(split.plan.length);
    expect(split.archiveName).toBe("deck__smart_split.zip");
    expect(split.archiveBase64.length).toBeGreaterThan(0);
  });

  it("keeps the original PDF bytes reusable after inspection", async () => {
    const bytes = await buildPdf(6);

    await expect(inspectPdfBytes(bytes)).resolves.toMatchObject({ pageCount: 6 });
    await expect(
      extractPdfPageRangeFromBytes(bytes, {
        filename: "deck.pdf",
        startPage: 1,
        endPage: 2,
      }),
    ).resolves.toMatchObject({
      pageRange: {
        startPage: 1,
        endPage: 2,
        pageCount: 2,
      },
    });
  });

  it("prefers section boundaries when the PDF clearly exposes them", () => {
    const plan = buildSmartSplitPlan({
      pageCount: 3,
      outline: ["Executive Summary", "Revenue Highlights", "Operations Notes"],
      pageHints: [
        {
          pageNumber: 1,
          titleCandidate: "Executive Summary",
          summary: "Quarterly summary for leadership.",
        },
        {
          pageNumber: 2,
          titleCandidate: "Revenue Highlights",
          summary: "West revenue accelerated sharply this quarter.",
        },
        {
          pageNumber: 3,
          titleCandidate: "Operations Notes",
          summary: "Support volume increased in February before normalizing.",
        },
      ],
    });

    expect(plan).toEqual([
      expect.objectContaining({ title: "Executive Summary", startPage: 1, endPage: 1 }),
      expect.objectContaining({ title: "Revenue Highlights", startPage: 2, endPage: 2 }),
      expect.objectContaining({ title: "Operations Notes", startPage: 3, endPage: 3 }),
    ]);
  });

  it("falls back to chunking when structural signals are weak", () => {
    const plan = buildSmartSplitPlan({
      pageCount: 6,
      outline: [],
      pageHints: [
        { pageNumber: 1, titleCandidate: "Section 1", summary: "" },
        { pageNumber: 2, titleCandidate: "Section 2", summary: "" },
        { pageNumber: 3, titleCandidate: "Section 3", summary: "" },
        { pageNumber: 4, titleCandidate: "Section 4", summary: "" },
        { pageNumber: 5, titleCandidate: "Section 5", summary: "" },
        { pageNumber: 6, titleCandidate: "Section 6", summary: "" },
      ],
    });

    expect(plan).toEqual([
      expect.objectContaining({ startPage: 1, endPage: 2 }),
      expect.objectContaining({ startPage: 3, endPage: 4 }),
      expect.objectContaining({ startPage: 5, endPage: 6 }),
    ]);
  });
});
