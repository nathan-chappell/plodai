import { describe, expect, it } from "vitest";

import { parseJsonText } from "../json";

describe("json parsing", () => {
  it("parses array-of-object derived datasets", () => {
    expect(parseJsonText('[{"region":"North","revenue":100},{"region":"South","revenue":50}]')).toEqual({
      rowCount: 2,
      columns: ["region", "revenue"],
      numericColumns: ["revenue"],
      rows: [
        { region: "North", revenue: 100 },
        { region: "South", revenue: 50 },
      ],
      previewRows: [
        { region: "North", revenue: 100 },
        { region: "South", revenue: 50 },
      ],
      sampleRows: [
        { region: "North", revenue: 100 },
        { region: "South", revenue: 50 },
      ],
      jsonText: JSON.stringify(
        [
          { region: "North", revenue: 100 },
          { region: "South", revenue: 50 },
        ],
        null,
        2,
      ),
    });
  });

  it("rejects non-array JSON shapes", () => {
    expect(() => parseJsonText('{"region":"North"}')).toThrow("top-level array");
  });
});
