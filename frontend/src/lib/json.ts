import type { DataRow } from "../types/analysis";

export type JsonPreview = {
  rowCount: number;
  columns: string[];
  numericColumns: string[];
  sampleRows: DataRow[];
  rows: DataRow[];
  previewRows: DataRow[];
  jsonText: string;
};

export function parseJsonText(text: string): JsonPreview {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("JSON datasets must use a top-level array of objects.");
  }

  const rows = raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`JSON row ${index + 1} is not an object.`);
    }
    return normalizeRow(entry as Record<string, unknown>);
  });
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const sampleRows = rows.slice(0, 5);
  const previewRows = rows.slice(0, 100);
  const numericColumns = columns.filter((column) =>
    sampleRows.length > 0 && sampleRows.every((row) => row[column] == null || typeof row[column] === "number"),
  );

  return {
    rowCount: rows.length,
    columns,
    numericColumns,
    sampleRows,
    rows,
    previewRows,
    jsonText: JSON.stringify(rows, null, 2),
  };
}

export function parseJsonPreview(file: File): Promise<JsonPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      try {
        resolve(parseJsonText(String(reader.result ?? "[]")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Unable to parse JSON preview."));
      }
    };

    reader.readAsText(file);
  });
}

function normalizeRow(row: Record<string, unknown>): DataRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]),
  ) as DataRow;
}

function normalizeValue(value: unknown): DataRow[string] {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}
