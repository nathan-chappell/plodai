// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentQuickViewFacts,
  renderDefaultAgentQuickViewPreview,
  type AgentQuickViewFact,
} from "../AgentQuickView";
import type { ShellWorkspaceArtifact } from "../../agents/types";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("buildAgentQuickViewFacts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:mock-pdf-preview"),
        revokeObjectURL: vi.fn(),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    vi.unstubAllGlobals();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("surfaces plain-English facts for uploaded datasets", () => {
    const artifact: ShellWorkspaceArtifact = {
      entryId: "uploaded-csv",
      createdAt: "2026-03-20T11:00:00.000Z",
      bucket: "uploaded",
      source: "uploaded",
      producerKey: "uploaded",
      producerLabel: "Uploaded",
      file: {
        id: "uploaded-csv-file",
        name: "sales_tour.csv",
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

    expect(buildAgentQuickViewFacts(artifact)).toEqual([
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
    const extraFacts: AgentQuickViewFact[] = [
      { key: "linked-source", value: "Source revenue_slice.csv" },
    ];

    expect(buildAgentQuickViewFacts(artifact, { extraFacts })).toEqual([
      { key: "kind", value: "Saved chart" },
      { key: "size", value: "512 B" },
      { key: "linked-source", value: "Source revenue_slice.csv" },
      { key: "source", value: "Derived artifact" },
    ]);
  });

  it("renders shared PDF previews inline in the preview pane", async () => {
    const artifact: ShellWorkspaceArtifact = {
      entryId: "pdf-file",
      createdAt: "2026-03-20T12:00:00.000Z",
      bucket: "pdf",
      source: "derived",
      producerKey: "document-agent",
      producerLabel: "Documents",
      file: {
        id: "pdf-file-id",
        name: "board_pack_tour.pdf",
        kind: "pdf",
        extension: "pdf",
        mime_type: "application/pdf",
        byte_size: 1800,
        page_count: 3,
        bytes_base64: "JVBERi0xLjQKJcfsj6IK",
      },
    };

    await act(async () => {
      root.render(
        renderDefaultAgentQuickViewPreview({
          selectedArtifact: artifact,
          selectedRow: {
            kind: "artifact",
            key: artifact.entryId,
            artifact,
          },
          artifactRows: [
            {
              kind: "artifact",
              key: artifact.entryId,
              artifact,
            },
          ],
          currentPage: 0,
          setPage: () => {},
          selectArtifact: () => {},
        }),
      );
    });

    expect(container.textContent).toContain("PDF preview");
    expect(container.textContent).toContain("If the embed does not load cleanly");
    expect(
      container.querySelector("[data-testid='agent-quick-view-pdf-iframe']"),
    ).not.toBeNull();
  });
});
