import { renderChartToDataUrl } from "./chart";
import { decodeBase64ToBytes, encodeBytesToBase64 } from "./base64";
import type { ClientChartSpec, DataRow } from "../types/analysis";
import type {
  DocumentFieldValue,
  DocumentLocator,
  DocumentLocatorBox,
  DocumentMergeSourceRange,
  DocumentPageSummary,
} from "../types/stored-file";

type PdfLibModule = typeof import("pdf-lib");

type PdfJsTextItem = {
  str?: unknown;
  transform?: number[];
  width?: number;
  height?: number;
};

type TextFragment = {
  text: string;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fontSize: number;
};

export type DocumentTextLocatorInfo = {
  id: string;
  pageNumber: number;
  text: string;
  bbox: [number, number, number, number];
  fontSize: number;
  fragments: TextFragment[];
};

export type DocumentFormFieldLocatorInfo = {
  id: string;
  pageNumber: number;
  fieldName: string;
  fieldType: string;
  bbox: [number, number, number, number];
};

export type DocumentPdfInspectionArtifacts = {
  pageCount: number;
  locators: DocumentLocator[];
  pageSummaries: DocumentPageSummary[];
  textLocators: Record<string, DocumentTextLocatorInfo>;
  formLocators: Record<string, DocumentFormFieldLocatorInfo>;
};

export type ReplaceDocumentTextResult = {
  pdfBytes: Uint8Array;
  strategyUsed: "direct_replace" | "overlay_replace";
  warning?: string;
};

export type FillDocumentFormResult = {
  pdfBytes: Uint8Array;
  unresolvedLocatorIds: string[];
  resolvedCount: number;
  warning?: string;
};

export type AppendDocumentAppendixResult = {
  pdfBytes: Uint8Array;
  warning?: string;
};

export type MergePdfSource = {
  fileId: string;
  pdfBytes: Uint8Array;
  startPage?: number;
  endPage?: number;
};

export type MergePdfBytesResult = {
  pdfBytes: Uint8Array;
  pageCount: number;
  sourceRanges: DocumentMergeSourceRange[];
};

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

const DEFAULT_FONT_SIZE = 10.5;
const LINE_GAP_TOLERANCE = 4.0;
const PARAGRAPH_GAP_MULTIPLIER = 1.9;
const LETTER_PAGE = { width: 612, height: 792 };

export async function inspectPdfBytes(
  pdfBytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<PdfInspection> {
  const { PDFDocument } = await loadPdfLib();
  const document = await PDFDocument.load(clonePdfBytes(pdfBytes));
  const pageCount = document.getPageCount();
  const inspectedPages = await inspectPdfText(
    clonePdfBytes(pdfBytes),
    Math.min(pageCount, options.maxPages ?? 8),
  );
  return {
    pageCount,
    outline: inspectedPages.outline,
    pageHints: inspectedPages.pageHints,
  };
}

export async function inspectDocumentPdfBytes(
  pdfBytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<DocumentPdfInspectionArtifacts> {
  const { PDFDocument } = await loadPdfLib();
  const pdfDocument = await PDFDocument.load(clonePdfBytes(pdfBytes));
  const pageCount = pdfDocument.getPageCount();
  const inspectedPageCount = Math.min(pageCount, options.maxPages ?? pageCount);
  const pageFragments = await loadDocumentTextFragments(
    clonePdfBytes(pdfBytes),
    inspectedPageCount,
  );

  const textLocators: Record<string, DocumentTextLocatorInfo> = {};
  const formLocators = await inspectDocumentFormFields(pdfDocument, inspectedPageCount);
  const publicLocators: DocumentLocator[] = [];
  const pageSummaries: DocumentPageSummary[] = [];

  for (let pageNumber = 1; pageNumber <= inspectedPageCount; pageNumber += 1) {
    const blocks = await groupTextBlocks(pageFragments.get(pageNumber) ?? []);
    for (const block of blocks) {
      textLocators[block.id] = block;
      publicLocators.push({
        id: block.id,
        kind: "text",
        label: trimLabel(block.text, 96),
        page_number: block.pageNumber,
        reliability: block.fragments.length > 1 ? "medium" : "high",
        bbox: bboxModel(block.bbox),
        text_preview: trimLabel(block.text, 180),
      });
    }

    const pageSummaryText = blocks
      .slice(0, 3)
      .map((block) => block.text)
      .join(" ")
      .trim();
    pageSummaries.push({
      page_number: pageNumber,
      summary: trimLabel(pageSummaryText || `Page ${pageNumber}`, 220),
    });
  }

  for (const field of Object.values(formLocators)) {
    publicLocators.push({
      id: field.id,
      kind: "form_field",
      label: field.fieldName,
      page_number: field.pageNumber,
      reliability: "high",
      bbox: bboxModel(field.bbox),
      text_preview: field.fieldName,
    });
  }

  publicLocators.sort((left, right) => {
    if (left.page_number !== right.page_number) {
      return left.page_number - right.page_number;
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.label.localeCompare(right.label);
  });

  return {
    pageCount,
    locators: publicLocators,
    pageSummaries,
    textLocators,
    formLocators,
  };
}

export async function replaceDocumentTextInPdfBytes(
  pdfBytes: Uint8Array,
  inspection: DocumentPdfInspectionArtifacts,
  options: {
    locatorId: string;
    replacementText: string;
  },
): Promise<ReplaceDocumentTextResult> {
  const locator = inspection.textLocators[options.locatorId];
  if (!locator) {
    throw new Error(`Unknown text locator: ${options.locatorId}`);
  }

  const cleanedReplacement = options.replacementText.trim();
  if (!cleanedReplacement) {
    throw new Error("Replacement text must be non-empty.");
  }

  const directResult = await tryDirectTextReplace(
    clonePdfBytes(pdfBytes),
    locator,
    cleanedReplacement,
  );
  if (directResult) {
    return {
      pdfBytes: directResult,
      strategyUsed: "direct_replace",
    };
  }

  const overlayResult = await tryOverlayTextReplace(
    clonePdfBytes(pdfBytes),
    locator,
    cleanedReplacement,
  );
  if (overlayResult) {
    return {
      pdfBytes: overlayResult,
      strategyUsed: "overlay_replace",
      warning:
        "Applied a safe overlay replacement because direct content-stream replacement was not reliable.",
    };
  }

  throw new Error("The replacement text could not be safely applied within the located region.");
}

export async function fillDocumentFormInPdfBytes(
  pdfBytes: Uint8Array,
  inspection: DocumentPdfInspectionArtifacts,
  fieldValues: DocumentFieldValue[],
): Promise<FillDocumentFormResult> {
  const {
    PDFCheckBox,
    PDFDocument,
    PDFDropdown,
    PDFOptionList,
    PDFRadioGroup,
    PDFTextField,
    StandardFonts,
  } = await loadPdfLib();
  const pdfDocument = await PDFDocument.load(clonePdfBytes(pdfBytes));
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    return {
      pdfBytes: clonePdfBytes(pdfBytes),
      unresolvedLocatorIds: fieldValues.map((value) => value.locator_id),
      resolvedCount: 0,
      warning: "XFA form fields are not supported in the browser-only PDF workflow.",
    };
  }

  const requestedValuesByField = new Map<
    string,
    { value: string; locatorIds: string[] }
  >();
  const unresolvedLocatorIds: string[] = [];

  for (const fieldValue of fieldValues) {
    const locator = inspection.formLocators[fieldValue.locator_id];
    if (!locator) {
      unresolvedLocatorIds.push(fieldValue.locator_id);
      continue;
    }
    const existing = requestedValuesByField.get(locator.fieldName);
    if (existing && existing.value !== fieldValue.value) {
      unresolvedLocatorIds.push(...existing.locatorIds, fieldValue.locator_id);
      requestedValuesByField.delete(locator.fieldName);
      continue;
    }
    if (existing) {
      existing.locatorIds.push(fieldValue.locator_id);
      continue;
    }
    requestedValuesByField.set(locator.fieldName, {
      value: fieldValue.value,
      locatorIds: [fieldValue.locator_id],
    });
  }

  let resolvedCount = 0;
  for (const [fieldName, request] of requestedValuesByField.entries()) {
    const field = form.getFieldMaybe(fieldName);
    if (!field) {
      unresolvedLocatorIds.push(...request.locatorIds);
      continue;
    }

    if (field instanceof PDFTextField) {
      field.setText(request.value);
      resolvedCount += request.locatorIds.length;
      continue;
    }

    if (field instanceof PDFCheckBox) {
      const nextChecked = parseCheckboxValue(request.value);
      if (nextChecked == null) {
        unresolvedLocatorIds.push(...request.locatorIds);
        continue;
      }
      if (nextChecked) {
        field.check();
      } else {
        field.uncheck();
      }
      resolvedCount += request.locatorIds.length;
      continue;
    }

    if (field instanceof PDFRadioGroup) {
      const selected = findUniqueOptionMatch(field.getOptions(), request.value);
      if (!selected) {
        unresolvedLocatorIds.push(...request.locatorIds);
        continue;
      }
      field.select(selected);
      resolvedCount += request.locatorIds.length;
      continue;
    }

    if (field instanceof PDFDropdown) {
      const selected = findUniqueOptionMatch(field.getOptions(), request.value);
      if (!selected) {
        unresolvedLocatorIds.push(...request.locatorIds);
        continue;
      }
      field.select(selected);
      resolvedCount += request.locatorIds.length;
      continue;
    }

    if (field instanceof PDFOptionList) {
      const selected = findUniqueOptionMatch(field.getOptions(), request.value);
      if (!selected) {
        unresolvedLocatorIds.push(...request.locatorIds);
        continue;
      }
      field.select(selected);
      resolvedCount += request.locatorIds.length;
      continue;
    }

    unresolvedLocatorIds.push(...request.locatorIds);
  }

  if (resolvedCount === 0) {
    return {
      pdfBytes: clonePdfBytes(pdfBytes),
      unresolvedLocatorIds: uniqueStrings(unresolvedLocatorIds),
      resolvedCount,
      warning: "None of the requested form fields could be resolved safely.",
    };
  }

  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  const savedBytes = await pdfDocument.save();
  return {
    pdfBytes: savedBytes,
    unresolvedLocatorIds: uniqueStrings(unresolvedLocatorIds),
    resolvedCount,
  };
}

export async function appendDatasetAppendixToPdfBytes(
  basePdfBytes: Uint8Array,
  options: {
    title: string;
    rows: DataRow[];
    renderAs: "table" | "chart";
  },
): Promise<AppendDocumentAppendixResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = await PDFDocument.load(clonePdfBytes(basePdfBytes));
  const appendix = await PDFDocument.create();
  let warning: string | undefined;

  if (options.renderAs === "chart") {
    const chartPageAdded = await appendChartAppendixPages(appendix, options.title, options.rows);
    if (!chartPageAdded) {
      warning =
        "The requested chart appendix fell back to a table because the dataset did not include a plottable numeric series.";
      await appendTableAppendixPages(appendix, options.title, options.rows);
    }
  } else {
    await appendTableAppendixPages(appendix, options.title, options.rows);
  }

  const appendixPages = await source.copyPages(
    appendix,
    Array.from({ length: appendix.getPageCount() }, (_, index) => index),
  );
  for (const page of appendixPages) {
    source.addPage(page);
  }

  return {
    pdfBytes: await source.save(),
    warning,
  };
}

export async function mergePdfBytes(
  sources: MergePdfSource[],
): Promise<MergePdfBytesResult> {
  if (sources.length < 2) {
    throw new Error("Select at least two PDF sources to merge.");
  }

  const { PDFDocument } = await loadPdfLib();
  const merged = await PDFDocument.create();
  const sourceRanges: DocumentMergeSourceRange[] = [];

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const hasStart = source.startPage != null;
    const hasEnd = source.endPage != null;
    if (hasStart !== hasEnd) {
      throw new Error(
        `Source ${index + 1} (${source.fileId}) must include both startPage and endPage or neither.`,
      );
    }

    const document = await PDFDocument.load(clonePdfBytes(source.pdfBytes));
    const totalPages = document.getPageCount();
    const normalizedRange =
      hasStart && hasEnd
        ? normalizePageRange(source.startPage ?? 1, source.endPage ?? 1, totalPages)
        : {
            startPage: 1,
            endPage: totalPages,
          };
    const sourcePageIndexes = Array.from(
      { length: normalizedRange.endPage - normalizedRange.startPage + 1 },
      (_, pageIndex) => normalizedRange.startPage - 1 + pageIndex,
    );
    const copiedPages = await merged.copyPages(document, sourcePageIndexes);
    for (const page of copiedPages) {
      merged.addPage(page);
    }
    sourceRanges.push({
      file_id: source.fileId,
      start_page: normalizedRange.startPage,
      end_page: normalizedRange.endPage,
      page_count: copiedPages.length,
    });
  }

  return {
    pdfBytes: await merged.save(),
    pageCount: merged.getPageCount(),
    sourceRanges,
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
  const { PDFDocument } = await loadPdfLib();
  const source = await PDFDocument.load(clonePdfBytes(pdfBytes));
  const totalPages = source.getPageCount();
  const { startPage, endPage } = normalizePageRange(options.startPage, options.endPage, totalPages);

  const target = await PDFDocument.create();
  const sourcePageIndexes = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage - 1 + index,
  );
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
  return decodeBase64ToBytes(base64);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return encodeBytesToBase64(bytes);
}

export function buildSubPdfFilename(filename: string, startPage: number, endPage: number): string {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${baseName}__pages_${startPage}-${endPage}.pdf`;
}

export function buildSmartSplitPlan(inspection: PdfInspection, goal?: string): SmartSplitPlanEntry[] {
  const sectionPlan = buildSectionAwareSmartSplitPlan(inspection, goal);
  if (sectionPlan.length >= 2) {
    return sectionPlan;
  }

  return buildChunkedSmartSplitPlan(inspection, goal);
}

function clonePdfBytes(pdfBytes: Uint8Array): Uint8Array {
  return pdfBytes.slice();
}

async function loadPdfLib(): Promise<PdfLibModule> {
  return await import("pdf-lib");
}

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

async function loadDocumentTextFragments(
  pdfBytes: Uint8Array,
  maxPages: number,
): Promise<Map<number, TextFragment[]>> {
  const fragmentsByPage = new Map<number, TextFragment[]>();
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: pdfBytes,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const document = await loadingTask.promise;
    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const fragments: TextFragment[] = [];
      for (const item of textContent.items as PdfJsTextItem[]) {
        const cleaned = joinWhitespace(String(item.str ?? ""));
        if (!cleaned) {
          continue;
        }
        const transform = Array.isArray(item.transform) ? item.transform : [];
        const x0 = Number(transform[4] ?? 0);
        const y0 = Number(transform[5] ?? 0);
        const fontSize = Math.max(
          Number(item.height ?? 0),
          Math.abs(Number(transform[0] ?? 0)),
          Math.abs(Number(transform[3] ?? 0)),
          DEFAULT_FONT_SIZE,
        );
        const width = Math.max(Number(item.width ?? 0), fontSize * Math.max(cleaned.length, 1) * 0.35);
        fragments.push({
          text: cleaned,
          pageNumber: pageIndex,
          x0,
          y0,
          x1: x0 + width,
          y1: y0 + fontSize,
          fontSize,
        });
      }
      fragments.sort((left, right) => {
        if (left.pageNumber !== right.pageNumber) {
          return left.pageNumber - right.pageNumber;
        }
        if (Math.abs(left.y0 - right.y0) > 0.001) {
          return right.y0 - left.y0;
        }
        return left.x0 - right.x0;
      });
      fragmentsByPage.set(pageIndex, fragments);
    }
  } catch {
    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      fragmentsByPage.set(pageIndex, []);
    }
  }
  return fragmentsByPage;
}

async function groupTextBlocks(
  fragments: TextFragment[],
): Promise<DocumentTextLocatorInfo[]> {
  if (!fragments.length) {
    return [];
  }

  const lines: TextFragment[][] = [];
  for (const fragment of fragments) {
    const currentLine = lines.at(-1);
    if (!currentLine || Math.abs(currentLine[0].y0 - fragment.y0) > LINE_GAP_TOLERANCE) {
      lines.push([fragment]);
      continue;
    }
    currentLine.push(fragment);
  }

  const blocks: TextFragment[][] = [];
  for (const line of lines.map((entry) => [...entry].sort((left, right) => left.x0 - right.x0))) {
    const previousBlock = blocks.at(-1);
    if (!previousBlock) {
      blocks.push([...line]);
      continue;
    }
    const previousLineY = Math.max(...previousBlock.slice(-line.length).map((fragment) => fragment.y0));
    const currentLineY = Math.max(...line.map((fragment) => fragment.y0));
    const averageSize =
      line.reduce((total, fragment) => total + fragment.fontSize, 0) / Math.max(line.length, 1);
    if (previousLineY - currentLineY <= averageSize * PARAGRAPH_GAP_MULTIPLIER) {
      previousBlock.push(...line);
    } else {
      blocks.push([...line]);
    }
  }

  const textBlocks: DocumentTextLocatorInfo[] = [];
  let blockIndex = 1;
  for (const blockFragments of blocks) {
    const text = joinBlockText(blockFragments);
    if (!text) {
      continue;
    }
    const x0 = Math.min(...blockFragments.map((fragment) => fragment.x0));
    const y0 = Math.min(...blockFragments.map((fragment) => fragment.y0)) - 2;
    const x1 = Math.max(...blockFragments.map((fragment) => fragment.x1));
    const y1 = Math.max(...blockFragments.map((fragment) => fragment.y1)) + 2;
    const pageNumber = blockFragments[0].pageNumber;
    const fontSize =
      blockFragments.reduce((total, fragment) => total + fragment.fontSize, 0) /
      Math.max(blockFragments.length, 1);
    const bbox: [number, number, number, number] = [x0, y0, x1, y1];
    const id = await stableLocatorId("text", pageNumber, text, blockIndex, bbox);
    textBlocks.push({
      id,
      pageNumber,
      text,
      bbox,
      fontSize,
      fragments: blockFragments,
    });
    blockIndex += 1;
  }
  return textBlocks;
}

async function inspectDocumentFormFields(
  pdfDocument: any,
  maxPages: number,
): Promise<Record<string, DocumentFormFieldLocatorInfo>> {
  const formLocators: Record<string, DocumentFormFieldLocatorInfo> = {};
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    return formLocators;
  }

  const fields = form.getFields();
  for (const field of fields) {
    const widgets = field.acroField.getWidgets();
    for (let widgetIndex = 0; widgetIndex < widgets.length; widgetIndex += 1) {
      const widget = widgets[widgetIndex];
      const pageNumber = await findWidgetPageNumber(pdfDocument, widget);
      if (pageNumber == null || pageNumber > maxPages) {
        continue;
      }
      const rectangle = widget.getRectangle();
      const bbox: [number, number, number, number] = [
        rectangle.x,
        rectangle.y,
        rectangle.x + rectangle.width,
        rectangle.y + rectangle.height,
      ];
      const id = await stableLocatorId("form", pageNumber, field.getName(), widgetIndex, bbox);
      formLocators[id] = {
        id,
        pageNumber,
        fieldName: field.getName(),
        fieldType: field.constructor.name,
        bbox,
      };
    }
  }

  return formLocators;
}

async function tryDirectTextReplace(
  pdfBytes: Uint8Array,
  locator: DocumentTextLocatorInfo,
  replacementText: string,
): Promise<Uint8Array | null> {
  if (locator.fragments.length !== 1) {
    return null;
  }

  const originalText = locator.fragments[0]?.text ?? "";
  if (!originalText || !isAsciiText(originalText) || !isAsciiText(replacementText)) {
    return null;
  }

  const {
    PDFArray,
    PDFDocument,
    PDFName,
    PDFRawStream,
    PDFRef,
    StandardFonts,
    decodePDFRawStream,
  } = await loadPdfLib();
  const pdfDocument = await PDFDocument.load(pdfBytes);
  const page = pdfDocument.getPage(locator.pageNumber - 1);
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const availableWidth = locator.bbox[2] - locator.bbox[0];
  if (font.widthOfTextAtSize(replacementText, Math.max(locator.fontSize, 8)) > availableWidth + 4) {
    return null;
  }

  const contentsObject = page.node.get(PDFName.of("Contents"));
  if (!contentsObject) {
    return null;
  }

  const streamCandidates: Array<{
    rawStream: any;
    ref: any | null;
    array: any | null;
    index: number | null;
    decoded: string;
    needle: string;
    replacement: string;
  }> = [];
  const encodedOriginalText = font.encodeText(originalText).toString();
  const encodedReplacementText = font.encodeText(replacementText).toString();

  const collectStreamCandidate = (
    rawStream: any,
    ref: any | null,
    array: any | null,
    index: number | null,
  ) => {
    if (!rawStream) {
      return;
    }
    const decodedValue = decodePDFRawStream(rawStream).decode();
    const decoded =
      typeof decodedValue === "string"
        ? decodedValue
        : new TextDecoder().decode(decodedValue);
    const plainOccurrenceCount = countOccurrences(decoded, originalText);
    const encodedOccurrenceCount = countOccurrences(decoded, encodedOriginalText);
    if (plainOccurrenceCount === 1 && encodedOccurrenceCount === 0) {
      streamCandidates.push({
        rawStream,
        ref,
        array,
        index,
        decoded,
        needle: originalText,
        replacement: replacementText,
      });
    } else if (encodedOccurrenceCount === 1 && plainOccurrenceCount === 0) {
      streamCandidates.push({
        rawStream,
        ref,
        array,
        index,
        decoded,
        needle: encodedOriginalText,
        replacement: encodedReplacementText,
      });
    }
  };

  if (contentsObject instanceof PDFArray) {
    for (let index = 0; index < contentsObject.size(); index += 1) {
      const entry = contentsObject.get(index);
      const lookedUpEntry = pdfDocument.context.lookup(entry);
      const rawStream = lookedUpEntry instanceof PDFRawStream ? lookedUpEntry : null;
      collectStreamCandidate(
        rawStream,
        entry instanceof PDFRef ? entry : null,
        contentsObject,
        index,
      );
    }
  } else {
    const lookedUpContents = pdfDocument.context.lookup(contentsObject);
    const rawStream = lookedUpContents instanceof PDFRawStream ? lookedUpContents : null;
    collectStreamCandidate(
      rawStream,
      contentsObject instanceof PDFRef ? contentsObject : null,
      null,
      null,
    );
  }

  if (streamCandidates.length !== 1) {
    return null;
  }

  const match = streamCandidates[0];
  const updatedDecoded = match.decoded.replace(match.needle, match.replacement);
  const streamDict = match.rawStream.dict.clone(pdfDocument.context);
  streamDict.delete(PDFName.of("Filter"));
  streamDict.delete(PDFName.of("DecodeParms"));
  streamDict.delete(PDFName.of("Length"));
  const updatedStream = pdfDocument.context.flateStream(
    new TextEncoder().encode(updatedDecoded),
    streamDict as never,
  );

  if (match.ref) {
    pdfDocument.context.assign(match.ref, updatedStream);
  } else if (match.array && match.index != null) {
    match.array.set(match.index, updatedStream);
  } else {
    page.node.set(PDFName.of("Contents"), updatedStream);
  }

  return await pdfDocument.save();
}

async function tryOverlayTextReplace(
  pdfBytes: Uint8Array,
  locator: DocumentTextLocatorInfo,
  replacementText: string,
): Promise<Uint8Array | null> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdfDocument = await PDFDocument.load(pdfBytes);
  const page = pdfDocument.getPage(locator.pageNumber - 1);
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const { width: pageWidth } = page.getSize();
  const [x0, y0, x1, y1] = locator.bbox;
  const fontSize = clamp(locator.fontSize, 9, 14);
  const desiredWidth = font.widthOfTextAtSize(replacementText, fontSize) + 12;
  const maxWidth = Math.max(48, pageWidth - x0 - 36);
  const boxWidth = Math.min(maxWidth, Math.max(24, x1 - x0, desiredWidth));
  const boxHeight = Math.max(24, (y1 - y0) + fontSize);
  const wrappedLines = wrapPdfText(replacementText, font, fontSize, boxWidth - 8);
  const lineHeight = fontSize * 1.25;
  const requiredHeight = wrappedLines.length * lineHeight + 8;
  if (requiredHeight > boxHeight + 2) {
    return null;
  }

  page.drawRectangle({
    x: x0 - 2,
    y: y0 - 2,
    width: boxWidth + 4,
    height: boxHeight + 4,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
  let cursorY = y1 - fontSize;
  for (const line of wrappedLines) {
    page.drawText(line, {
      x: x0 + 2,
      y: cursorY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    cursorY -= lineHeight;
  }

  return await pdfDocument.save();
}

async function appendChartAppendixPages(
  pdfDocument: any,
  title: string,
  rows: DataRow[],
): Promise<boolean> {
  const chartSpec = buildAppendixChartSpec(title, rows);
  if (!chartSpec) {
    return false;
  }

  const chartDataUrl = await renderChartToDataUrl(chartSpec, rows);
  if (!chartDataUrl) {
    return false;
  }

  const { StandardFonts, rgb } = await loadPdfLib();
  const page = pdfDocument.addPage([LETTER_PAGE.width, LETTER_PAGE.height]);
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
  const pngImage = await pdfDocument.embedPng(chartDataUrl);
  const margin = 40;
  const titleY = LETTER_PAGE.height - margin - 10;
  page.drawText(trimLabel(title, 84), {
    x: margin,
    y: titleY,
    size: 16,
    font: boldFont,
    color: rgb(0.07, 0.1, 0.16),
  });
  page.drawText("Dataset appendix", {
    x: margin,
    y: titleY - 18,
    size: 10,
    font,
    color: rgb(0.36, 0.41, 0.47),
  });

  const maxWidth = LETTER_PAGE.width - margin * 2;
  const maxHeight = LETTER_PAGE.height - margin * 2 - 42;
  const scaled = pngImage.scale(Math.min(maxWidth / pngImage.width, maxHeight / pngImage.height));
  page.drawImage(pngImage, {
    x: margin + (maxWidth - scaled.width) / 2,
    y: margin,
    width: scaled.width,
    height: scaled.height,
  });
  return true;
}

async function appendTableAppendixPages(
  pdfDocument: any,
  title: string,
  rows: DataRow[],
): Promise<void> {
  const { StandardFonts, rgb } = await loadPdfLib();
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
  const columns = rows.length ? Object.keys(rows[0]).slice(0, 6) : ["Notes"];
  const normalizedRows = rows.length ? rows : [{ Notes: "Dataset was empty." }];
  const margin = 36;
  const rowHeight = 18;
  const titleBlockHeight = 46;
  const rowsPerPage = Math.max(
    1,
    Math.floor((LETTER_PAGE.height - margin * 2 - titleBlockHeight) / rowHeight) - 1,
  );

  for (let pageIndex = 0; pageIndex * rowsPerPage < normalizedRows.length; pageIndex += 1) {
    const page = pdfDocument.addPage([LETTER_PAGE.width, LETTER_PAGE.height]);
    page.drawText(trimLabel(title, 84), {
      x: margin,
      y: LETTER_PAGE.height - margin - 4,
      size: 15,
      font: boldFont,
      color: rgb(0.07, 0.1, 0.16),
    });
    page.drawText(
      pageIndex === 0 ? "Dataset appendix" : `Dataset appendix (continued ${pageIndex + 1})`,
      {
        x: margin,
        y: LETTER_PAGE.height - margin - 22,
        size: 10,
        font,
        color: rgb(0.36, 0.41, 0.47),
      },
    );

    const chunk = normalizedRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    const columnWidth = (LETTER_PAGE.width - margin * 2) / columns.length;
    const tableTop = LETTER_PAGE.height - margin - titleBlockHeight;

    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const x = margin + columnIndex * columnWidth;
      page.drawRectangle({
        x,
        y: tableTop,
        width: columnWidth,
        height: rowHeight,
        color: rgb(0.12, 0.16, 0.22),
        borderWidth: 0.5,
        borderColor: rgb(0.82, 0.85, 0.89),
      });
      page.drawText(trimCellText(columns[columnIndex], 22), {
        x: x + 4,
        y: tableTop + 5,
        size: 9,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
    }

    chunk.forEach((row, rowIndex) => {
      const y = tableTop - rowHeight * (rowIndex + 1);
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const x = margin + columnIndex * columnWidth;
        page.drawRectangle({
          x,
          y,
          width: columnWidth,
          height: rowHeight,
          color: rowIndex % 2 === 0 ? rgb(0.98, 0.98, 0.99) : rgb(0.95, 0.96, 0.97),
          borderWidth: 0.5,
          borderColor: rgb(0.82, 0.85, 0.89),
        });
        page.drawText(trimCellText(row[columns[columnIndex]], 26), {
          x: x + 4,
          y: y + 5,
          size: 8.5,
          font,
          color: rgb(0.07, 0.1, 0.16),
        });
      }
    });
  }
}

async function stableLocatorId(
  prefix: string,
  pageNumber: number,
  text: string,
  index: number,
  bbox: [number, number, number, number],
): Promise<string> {
  const payload =
    `${prefix}|${pageNumber}|${index}|${bbox[0].toFixed(1)}|${bbox[1].toFixed(1)}|` +
    `${bbox[2].toFixed(1)}|${bbox[3].toFixed(1)}|${text.trim()}`;
  const digest = await sha1Hex(payload);
  return `${prefix}_${digest.slice(0, 12)}`;
}

async function sha1Hex(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(5);
}

function isAsciiText(value: string): boolean {
  return Array.from(value).every((character) => character.charCodeAt(0) <= 126);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let currentIndex = 0;
  while (true) {
    const nextIndex = haystack.indexOf(needle, currentIndex);
    if (nextIndex < 0) {
      return count;
    }
    count += 1;
    currentIndex = nextIndex + needle.length;
  }
}

function wrapPdfText(
  text: string,
  font: {
    widthOfTextAtSize: (value: string, size: number) => number;
  },
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = joinWhitespace(text).split(" ").filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(nextLine, fontSize) <= maxWidth || !currentLine) {
      currentLine = nextLine;
      continue;
    }
    lines.push(currentLine);
    currentLine = word;
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function buildAppendixChartSpec(
  title: string,
  rows: DataRow[],
): ClientChartSpec | null {
  if (!rows.length) {
    return null;
  }
  const columns = Object.keys(rows[0]);
  const numericColumns = columns.filter((column) =>
    rows.slice(0, 12).every((row) => typeof row[column] === "number"),
  );
  if (!numericColumns.length) {
    return null;
  }
  const labelKey =
    columns.find((column) => !numericColumns.includes(column)) ??
    columns[0] ??
    numericColumns[0];
  return {
    type: "bar",
    title,
    subtitle: "Generated in the browser",
    label_key: labelKey,
    series: numericColumns.slice(0, 3).map((column) => ({
      label: column,
      data_key: column,
    })),
    style_preset: "ledger",
    show_legend: numericColumns.length > 1,
    interactive: false,
    show_grid: true,
    value_format: "number",
  };
}

async function findWidgetPageNumber(
  pdfDocument: any,
  widget: {
    P: () => unknown;
    dict: unknown;
  },
): Promise<number | null> {
  const { PDFArray, PDFRef } = await loadPdfLib();
  const pageRef = widget.P();
  const pages = pdfDocument.getPages();
  if (pageRef instanceof PDFRef) {
    const directIndex = pages.findIndex((page: any) => page.ref === pageRef);
    if (directIndex >= 0) {
      return directIndex + 1;
    }
  }

  const widgetRef = pdfDocument.context.getObjectRef(widget.dict as never);
  if (!widgetRef) {
    return null;
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const annots = pages[pageIndex].node.Annots();
    if (!(annots instanceof PDFArray)) {
      continue;
    }
    const match = annots.asArray().some((entry) => entry === widgetRef);
    if (match) {
      return pageIndex + 1;
    }
  }

  return null;
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

function buildSectionAwareSmartSplitPlan(
  inspection: PdfInspection,
  goal?: string,
): SmartSplitPlanEntry[] {
  const boundaryStarts = inspection.pageHints
    .filter((pageHint) => isStrongSectionBoundary(pageHint, inspection.outline))
    .map((pageHint) => pageHint.pageNumber);
  const normalizedStarts = Array.from(new Set([1, ...boundaryStarts]))
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= inspection.pageCount)
    .sort((left, right) => left - right);

  if (normalizedStarts.length < 2) {
    return [];
  }

  const goalPrefix = goal?.trim() ? `${goal.trim()}: ` : "";
  return normalizedStarts.map((startPage, index) => {
    const endPage =
      index < normalizedStarts.length - 1
        ? normalizedStarts[index + 1] - 1
        : inspection.pageCount;
    const startHint =
      inspection.pageHints.find((pageHint) => pageHint.pageNumber === startPage)?.titleCandidate ||
      `Section ${index + 1}`;
    return {
      title: `${goalPrefix}${normalizeSectionTitle(startHint, startPage)}`.slice(0, 96),
      startPage,
      endPage,
    };
  });
}

function buildChunkedSmartSplitPlan(
  inspection: PdfInspection,
  goal?: string,
): SmartSplitPlanEntry[] {
  const targetChunkSize = inspection.pageCount <= 6 ? 2 : inspection.pageCount <= 15 ? 4 : 6;
  const boundaryPages = new Set<number>();
  for (const pageHint of inspection.pageHints) {
    if (
      pageHint.titleCandidate &&
      normalizeSectionTitle(pageHint.titleCandidate, pageHint.pageNumber) !== `Section ${pageHint.pageNumber}`
    ) {
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
      title: `${goalPrefix}${normalizeSectionTitle(startHint, startPage)}`.slice(0, 96),
      startPage,
      endPage,
    });
    startPage = endPage + 1;
  }
  return segments;
}

function isStrongSectionBoundary(pageHint: PdfInspectionPage, outline: string[]): boolean {
  const normalizedTitle = normalizeSectionTitle(pageHint.titleCandidate, pageHint.pageNumber);
  if (normalizedTitle === `Section ${pageHint.pageNumber}`) {
    return false;
  }
  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
  if (outline.some((item) => normalizeTitleForMatch(item) === normalizeTitleForMatch(normalizedTitle))) {
    return true;
  }
  return titleWords.length <= 6 || normalizedTitle.length <= 42;
}

function normalizeSectionTitle(title: string, pageNumber: number): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed === `Section ${pageNumber}`) {
    return `Section ${pageNumber}`;
  }
  return trimmed.replace(/\s+/g, " ");
}

function normalizeTitleForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
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

function bboxModel(bbox: [number, number, number, number]): DocumentLocatorBox {
  return {
    x0: round2(bbox[0]),
    y0: round2(bbox[1]),
    x1: round2(bbox[2]),
    y1: round2(bbox[3]),
  };
}

function joinBlockText(blockFragments: TextFragment[]): string {
  const sortedFragments = [...blockFragments].sort((left, right) => {
    if (Math.abs(left.y0 - right.y0) > 0.001) {
      return right.y0 - left.y0;
    }
    return left.x0 - right.x0;
  });
  const chunks: string[] = [];
  let currentY: number | null = null;
  let currentLine: string[] = [];
  for (const fragment of sortedFragments) {
    if (currentY == null || Math.abs(currentY - fragment.y0) <= LINE_GAP_TOLERANCE) {
      currentLine.push(fragment.text);
      currentY = currentY == null ? fragment.y0 : currentY;
      continue;
    }
    chunks.push(currentLine.join(" "));
    currentLine = [fragment.text];
    currentY = fragment.y0;
  }
  if (currentLine.length) {
    chunks.push(currentLine.join(" "));
  }
  return chunks.map((chunk) => chunk.trim()).filter(Boolean).join("\n").trim();
}

function parseCheckboxValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "checked", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0", "unchecked", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function findUniqueOptionMatch(options: string[], requestedValue: string): string | null {
  const trimmedValue = requestedValue.trim();
  if (!trimmedValue) {
    return null;
  }
  const exactMatch = options.find((option) => option === trimmedValue);
  if (exactMatch) {
    return exactMatch;
  }
  const normalizedValue = trimmedValue.toLowerCase();
  const caseInsensitiveMatches = options.filter(
    (option) => option.trim().toLowerCase() === normalizedValue,
  );
  return caseInsensitiveMatches.length === 1 ? caseInsensitiveMatches[0] : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function trimLabel(value: string, limit: number): string {
  const cleaned = joinWhitespace(value);
  if (cleaned.length <= limit) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function trimCellText(value: unknown, limit: number): string {
  const text =
    typeof value === "number"
      ? `${value}`
      : value == null
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
  return trimLabel(text, limit);
}

function joinWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
