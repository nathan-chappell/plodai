export type CsvPreview = {
  rowCount: number;
  columns: string[];
  numericColumns: string[];
  sampleRows: Record<string, string>[];
  rows: Record<string, string>[];
  previewRows: Record<string, string>[];
};

export function parseCsvText(text: string): CsvPreview {
  const rows = parseCsvRows(text);
  if (!rows.length) {
    return {
      rowCount: 0,
      columns: [],
      numericColumns: [],
      sampleRows: [],
      rows: [],
      previewRows: [],
    };
  }

  const [header, ...dataRows] = rows;
  const columns = header.map((column) => column.trim());
  const mappedRows = dataRows.map((cells) =>
    Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""])),
  );
  const sampleRows = mappedRows.slice(0, 5);
  const previewRows = mappedRows.slice(0, 100);
  const numericColumns = columns.filter((column) =>
    sampleRows.length > 0 && sampleRows.every((row) => row[column] === "" || isFiniteNumber(row[column])),
  );

  return {
    rowCount: dataRows.length,
    columns,
    numericColumns,
    sampleRows,
    rows: mappedRows,
    previewRows,
  };
}

export function parseCsvPreview(file: File): Promise<CsvPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      resolve(parseCsvText(String(reader.result ?? "")));
    };

    reader.readAsText(file);
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell);
    currentCell = "";
  };

  const pushRow = () => {
    if (currentRow.length === 0 && currentCell === "") {
      return;
    }
    pushCell();
    if (currentRow.some((cell) => cell.trim() !== "")) {
      rows.push(currentRow.map((cell) => cell.trim()));
    }
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      pushCell();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    pushRow();
  }

  return rows;
}

function isFiniteNumber(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  return Number.isFinite(Number(value));
}
