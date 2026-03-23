import type { ReportSlideLayout } from "../types/workspace-contract";

export type ReportSlideGridTemplate = {
  columns: string;
  rows?: string;
};

const REPORT_SLIDE_GRID_TEMPLATES = {
  "1x1": {
    columns: "minmax(0, 1fr)",
  },
  "1x2": {
    columns: "repeat(2, minmax(0, 1fr))",
  },
  "2x2": {
    columns: "repeat(2, minmax(0, 1fr))",
    rows: "repeat(2, minmax(0, 1fr))",
  },
} satisfies Record<ReportSlideLayout, ReportSlideGridTemplate>;

export function getReportSlideGridTemplate(layout: ReportSlideLayout): ReportSlideGridTemplate {
  return REPORT_SLIDE_GRID_TEMPLATES[layout];
}
