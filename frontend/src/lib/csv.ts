export function parseCsvPreview(file: File): Promise<{
  rowCount: number;
  columns: string[];
  sampleRows: Record<string, string>[];
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        resolve({ rowCount: 0, columns: [], sampleRows: [] });
        return;
      }

      const columns = splitCsvLine(lines[0]);
      const rows = lines.slice(1).map(splitCsvLine);
      const sampleRows = rows.slice(0, 5).map((cells) =>
        Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""])),
      );

      resolve({
        rowCount: rows.length,
        columns,
        sampleRows,
      });
    };

    reader.readAsText(file);
  });
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
}
