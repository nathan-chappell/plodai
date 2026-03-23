import { describe, expect, it } from "vitest";

import { getReportSlideGridTemplate } from "../report-slide-layout";

describe("getReportSlideGridTemplate", () => {
  it("keeps one-by-two slides in a two-column layout", () => {
    expect(getReportSlideGridTemplate("1x2")).toEqual({
      columns: "repeat(2, minmax(0, 1fr))",
    });
  });

  it("uses two rows only for two-by-two slides", () => {
    expect(getReportSlideGridTemplate("2x2")).toEqual({
      columns: "repeat(2, minmax(0, 1fr))",
      rows: "repeat(2, minmax(0, 1fr))",
    });
  });
});
