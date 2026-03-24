import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { setBase64CodecForTests } from "../base64";
import {
  appendDatasetAppendixToPdfBytes,
  base64ToUint8Array,
  buildSmartSplitPlan,
  buildSubPdfFilename,
  extractPdfPageRangeFromBytes,
  fillDocumentFormInPdfBytes,
  inspectDocumentPdfBytes,
  inspectPdfBytes,
  mergePdfBytes,
  replaceDocumentTextInPdfBytes,
  smartSplitPdfBytes,
  uint8ArrayToBase64,
} from "../pdf";

async function buildPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([400, 400]);
  }
  return document.save();
}

async function buildTextPdf(text: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 400]);
  page.drawText(text, {
    x: 48,
    y: 320,
    size: 14,
    font,
  });
  return document.save();
}

async function buildTextPdfPages(texts: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = document.addPage([400, 400]);
    page.drawText(text, {
      x: 48,
      y: 320,
      size: 14,
      font,
    });
  }
  return document.save();
}

async function buildSizedPdfPages(pageSizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const pageSize of pageSizes) {
    document.addPage(pageSize);
  }
  return await document.save();
}

async function buildDocumentFormPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([420, 420]);
  page.drawText("Quarterly Summary", {
    x: 48,
    y: 360,
    size: 18,
    font,
  });
  page.drawText("Revenue rose 12 percent year over year.", {
    x: 48,
    y: 330,
    size: 12,
    font,
  });

  const form = document.getForm();
  const nameField = form.createTextField("customer_name");
  nameField.addToPage(page, {
    x: 48,
    y: 250,
    width: 180,
    height: 24,
  });
  const approvedField = form.createCheckBox("approved");
  approvedField.addToPage(page, {
    x: 48,
    y: 210,
    width: 20,
    height: 20,
  });
  const departmentField = form.createDropdown("department");
  departmentField.setOptions(["Sales", "Support"]);
  departmentField.addToPage(page, {
    x: 48,
    y: 170,
    width: 180,
    height: 24,
  });

  return document.save();
}

describe("pdf helpers", () => {
  afterEach(() => {
    setBase64CodecForTests(null);
  });

  it("inspects page counts", async () => {
    const bytes = await buildPdf(4);
    await expect(inspectPdfBytes(bytes)).resolves.toMatchObject({ pageCount: 4 });
  });

  it("inspects document text locators, form fields, and page summaries", async () => {
    const bytes = await buildDocumentFormPdf();

    const inspection = await inspectDocumentPdfBytes(bytes, { maxPages: 1 });

    expect(inspection.pageCount).toBe(1);
    expect(inspection.pageSummaries).toEqual([
      expect.objectContaining({
        page_number: 1,
      }),
    ]);
    expect(
      inspection.pageSummaries[0]?.summary,
    ).toContain("Quarterly Summary");
    expect(
      inspection.locators.some(
        (locator) =>
          locator.kind === "text" &&
          (locator.label.includes("Quarterly Summary") ||
            locator.text_preview?.includes("Revenue rose")),
      ),
    ).toBe(true);
    expect(
      inspection.locators.filter((locator) => locator.kind === "form_field").map((locator) => locator.label),
    ).toEqual(expect.arrayContaining(["customer_name", "approved", "department"]));
  });

  it("routes base64 conversion through the injected codec override", () => {
    const decode = vi.fn((base64: string) => new Uint8Array([base64.length, 7]));
    const encode = vi.fn((bytes: Uint8Array) => `encoded:${bytes.length}`);
    setBase64CodecForTests({ decode, encode });

    expect(base64ToUint8Array("tour")).toEqual(new Uint8Array([4, 7]));
    expect(uint8ArrayToBase64(new Uint8Array([1, 2, 3]))).toBe("encoded:3");
    expect(decode).toHaveBeenCalledWith("tour");
    expect(encode).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
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

  it("replaces a direct text locator without falling back to overlay mode", async () => {
    const bytes = await buildTextPdf("Original copy");
    const inspection = await inspectDocumentPdfBytes(bytes);
    const locator = Object.values(inspection.textLocators).find((entry) =>
      entry.text.includes("Original copy"),
    );

    expect(locator).toBeTruthy();

    const replaced = await replaceDocumentTextInPdfBytes(bytes, inspection, {
      locatorId: locator!.id,
      replacementText: "New copy",
    });

    expect(replaced.strategyUsed).toBe("direct_replace");
    const updatedInspection = await inspectDocumentPdfBytes(replaced.pdfBytes);
    expect(
      Object.values(updatedInspection.textLocators).some((entry) =>
        entry.text.includes("New copy"),
      ),
    ).toBe(true);
  });

  it("fills supported form fields and reports unresolved ones", async () => {
    const bytes = await buildDocumentFormPdf();
    const inspection = await inspectDocumentPdfBytes(bytes);
    const nameLocator = inspection.locators.find((locator) => locator.label === "customer_name");
    const approvedLocator = inspection.locators.find((locator) => locator.label === "approved");
    const departmentLocator = inspection.locators.find((locator) => locator.label === "department");

    expect(nameLocator).toBeTruthy();
    expect(approvedLocator).toBeTruthy();
    expect(departmentLocator).toBeTruthy();

    const filled = await fillDocumentFormInPdfBytes(bytes, inspection, [
      { locator_id: nameLocator!.id, value: "Ada Lovelace" },
      { locator_id: approvedLocator!.id, value: "yes" },
      { locator_id: departmentLocator!.id, value: "Unknown" },
    ]);

    expect(filled.resolvedCount).toBe(2);
    expect(filled.unresolvedLocatorIds).toEqual([departmentLocator!.id]);

    const loaded = await PDFDocument.load(filled.pdfBytes);
    const form = loaded.getForm();
    expect(form.getTextField("customer_name").getText()).toBe("Ada Lovelace");
    expect(form.getCheckBox("approved").isChecked()).toBe(true);
  });

  it("appends a dataset appendix as new PDF pages", async () => {
    const bytes = await buildPdf(1);
    const appended = await appendDatasetAppendixToPdfBytes(bytes, {
      title: "Revenue appendix",
      renderAs: "table",
      rows: [
        { region: "West", revenue: 12 },
        { region: "East", revenue: 9 },
      ],
    });

    const loaded = await PDFDocument.load(appended.pdfBytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(appended.warning).toBeUndefined();
  });

  it("merges whole PDFs in the provided order", async () => {
    const first = await buildSizedPdfPages([[420, 420]]);
    const second = await buildSizedPdfPages([[520, 520]]);

    const merged = await mergePdfBytes([
      {
        fileId: "file-1",
        pdfBytes: first,
      },
      {
        fileId: "file-2",
        pdfBytes: second,
      },
    ]);

    expect(merged.pageCount).toBe(2);
    expect(merged.sourceRanges).toEqual([
      { file_id: "file-1", start_page: 1, end_page: 1, page_count: 1 },
      { file_id: "file-2", start_page: 1, end_page: 1, page_count: 1 },
    ]);

    const loaded = await PDFDocument.load(merged.pdfBytes);
    expect(loaded.getPages().map((page) => page.getSize())).toEqual([
      { width: 420, height: 420 },
      { width: 520, height: 520 },
    ]);
  });

  it("merges mixed page ranges and returns normalized source ranges", async () => {
    const first = await buildSizedPdfPages([
      [410, 410],
      [420, 420],
      [430, 430],
    ]);
    const second = await buildSizedPdfPages([
      [510, 510],
      [520, 520],
    ]);

    const merged = await mergePdfBytes([
      {
        fileId: "file-1",
        pdfBytes: first,
        startPage: 2,
        endPage: 3,
      },
      {
        fileId: "file-2",
        pdfBytes: second,
      },
    ]);

    expect(merged.pageCount).toBe(4);
    expect(merged.sourceRanges).toEqual([
      { file_id: "file-1", start_page: 2, end_page: 3, page_count: 2 },
      { file_id: "file-2", start_page: 1, end_page: 2, page_count: 2 },
    ]);

    const loaded = await PDFDocument.load(merged.pdfBytes);
    expect(loaded.getPages().map((page) => page.getSize())).toEqual([
      { width: 420, height: 420 },
      { width: 430, height: 430 },
      { width: 510, height: 510 },
      { width: 520, height: 520 },
    ]);
  });

  it("allows repeated source PDFs without deduping them", async () => {
    const source = await buildTextPdf("Reusable packet");

    const merged = await mergePdfBytes([
      {
        fileId: "file-1",
        pdfBytes: source,
      },
      {
        fileId: "file-1",
        pdfBytes: source,
      },
    ]);

    expect(merged.pageCount).toBe(2);
    expect(merged.sourceRanges).toEqual([
      { file_id: "file-1", start_page: 1, end_page: 1, page_count: 1 },
      { file_id: "file-1", start_page: 1, end_page: 1, page_count: 1 },
    ]);
  });

  it("rejects invalid merge ranges", async () => {
    const source = await buildTextPdfPages(["Alpha", "Bravo"]);

    await expect(
      mergePdfBytes([
        {
          fileId: "file-1",
          pdfBytes: source,
          startPage: 2,
        },
        {
          fileId: "file-2",
          pdfBytes: source,
        },
      ]),
    ).rejects.toThrow("must include both startPage and endPage");

    await expect(
      mergePdfBytes([
        {
          fileId: "file-1",
          pdfBytes: source,
        },
        {
          fileId: "file-2",
          pdfBytes: source,
          startPage: 1,
          endPage: 3,
        },
      ]),
    ).rejects.toThrow("exceed the PDF page count");
  });

  it("keeps original source PDFs reusable after merge", async () => {
    const first = await buildTextPdfPages(["Alpha", "Bravo"]);
    const second = await buildTextPdf("Charlie");

    const merged = await mergePdfBytes([
      {
        fileId: "file-1",
        pdfBytes: first,
      },
      {
        fileId: "file-2",
        pdfBytes: second,
      },
    ]);

    expect(merged.pageCount).toBe(3);
    await expect(inspectPdfBytes(first)).resolves.toMatchObject({ pageCount: 2 });
    await expect(inspectPdfBytes(second)).resolves.toMatchObject({ pageCount: 1 });
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
