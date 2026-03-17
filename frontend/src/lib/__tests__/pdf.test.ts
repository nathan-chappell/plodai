import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  base64ToUint8Array,
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
});
