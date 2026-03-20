import { describe, expect, it } from "vitest";

import {
  buildCapabilityQuickViewFacts,
  type CapabilityQuickViewFact,
} from "../CapabilityQuickView";
import type { ShellWorkspaceArtifact } from "../../capabilities/types";

describe("buildCapabilityQuickViewFacts", () => {
  it("surfaces plain-English facts for uploaded CSV files", () => {
    const artifact: ShellWorkspaceArtifact = {
      entryId: "uploaded-csv",
      createdAt: "2026-03-20T11:00:00.000Z",
      bucket: "uploaded",
      source: "uploaded",
      producerKey: "uploaded",
      producerLabel: "Uploaded",
      file: {
        id: "uploaded-csv-file",
        name: "sales_demo.csv",
        kind: "csv",
        extension: "csv",
        mime_type: "text/csv",
        byte_size: 182,
        row_count: 6,
        columns: ["month", "region", "category", "revenue", "units"],
        numeric_columns: ["revenue", "units"],
        sample_rows: [{ month: "Jan", region: "North", category: "Hardware", revenue: 120, units: 3 }],
        preview_rows: [],
        rows: [],
      },
    };

    expect(buildCapabilityQuickViewFacts(artifact)).toEqual([
      { key: "kind", value: "CSV" },
      { key: "size", value: "182 B" },
      { key: "rows", value: "6 rows" },
      { key: "columns", value: "5 columns" },
      { key: "source", value: "Uploaded file" },
    ]);
  });

  it("uses saved-chart language and preserves useful extra facts", () => {
    const artifact: ShellWorkspaceArtifact = {
      entryId: "saved-chart",
      createdAt: "2026-03-20T12:00:00.000Z",
      bucket: "chart",
      source: "derived",
      producerKey: "artifacts",
      producerLabel: "Artifacts",
      file: {
        id: "saved-chart-file",
        name: "revenue-plan.json",
        kind: "other",
        extension: "json",
        mime_type: "application/json",
        byte_size: 512,
        text_content: JSON.stringify({
          version: "v1",
          chart_plan_id: "plan-1",
          file_id: "source-csv",
          title: "Revenue by segment",
          chart: { type: "bar" },
          image_data_url: "data:image/png;base64,chart-preview",
        }),
      },
    };
    const extraFacts: CapabilityQuickViewFact[] = [
      { key: "linked-source", value: "Source revenue_slice.csv" },
    ];

    expect(buildCapabilityQuickViewFacts(artifact, { extraFacts })).toEqual([
      { key: "kind", value: "Saved chart" },
      { key: "size", value: "512 B" },
      { key: "linked-source", value: "Source revenue_slice.csv" },
      { key: "source", value: "Derived artifact" },
    ]);
  });
});
