import { describe, expect, it } from "vitest";

import { parseCsvText } from "../csv";

describe("csv parsing", () => {
  it("parses a simple csv preview", () => {
    expect(parseCsvText("region,revenue\nNorth,100\nSouth,50\n")).toEqual({
      rowCount: 2,
      columns: ["region", "revenue"],
      numericColumns: ["revenue"],
      sampleRows: [
        { region: "North", revenue: "100" },
        { region: "South", revenue: "50" },
      ],
    });
  });

  it("handles quoted commas and escaped quotes", () => {
    expect(parseCsvText('name,notes\n"Widget, Deluxe","He said ""hello"""\n')).toEqual({
      rowCount: 1,
      columns: ["name", "notes"],
      numericColumns: [],
      sampleRows: [{ name: "Widget, Deluxe", notes: 'He said "hello"' }],
    });
  });
});
