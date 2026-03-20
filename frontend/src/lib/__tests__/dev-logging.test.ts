import { describe, expect, it, vi } from "vitest";

import {
  _summarizeClientToolArgsForLog,
  _summarizeClientToolResultForLog,
  createDevLogger,
} from "../dev-logging";

function createConsoleSink() {
  return {
    error: vi.fn(),
    groupCollapsed: vi.fn(),
    groupEnd: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("dev logger", () => {
  it("is silent when disabled", () => {
    const sink = createConsoleSink();
    const logger = createDevLogger({ enabled: false, sink });

    logger.responseStart({
      capabilityId: "report-agent",
      fileCount: 2,
      running: true,
      threadId: "thr_123",
    });

    expect(sink.groupCollapsed).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
  });

  it("summarizes tool args without exposing filenames or raw text blobs", () => {
    expect(
      _summarizeClientToolArgsForLog({
        file_id: "file_123",
        filename: "q1-sales.csv",
        includeSamples: true,
        query_plan: {
          dataset_id: "sales_csv",
          group_by: ["region", "month"],
          aggregates: [{ op: "sum", field: "revenue" }],
        },
        chart_plan: {
          type: "bar",
          series: [{ label: "Revenue", data_key: "revenue" }],
        },
      }),
    ).toEqual({
      argumentKeys: ["chart_plan", "file_id", "filename", "includeSamples", "query_plan"],
      fileId: "file_123",
      filename: "q1-sales.csv",
      includeSamples: true,
      queryPlan: {
        datasetId: "sales_csv",
        groupByCount: 2,
        aggregateCount: 1,
      },
      chartPlan: {
        chartType: "bar",
        seriesCount: 1,
      },
    });
  });

  it("summarizes tool results without exposing rows or image payloads", () => {
    const summary = _summarizeClientToolResultForLog({
      row_count: 2,
      rows: [{ region: "West", revenue: 360 }],
      imageDataUrl: "data:image/png;base64,secret-chart",
      created_file: {
        kind: "json",
        id: "artifact_123",
      },
      file_input: {
        filename: "derived.json",
        file_data: "super-secret",
      },
    });

    expect(summary).toEqual({
      resultKeys: ["created_file", "file_input", "imageDataUrl", "row_count", "rows"],
      rowCount: 2,
      hasImageDataUrl: true,
      createdFileKind: "json",
      hasFileInput: true,
    });
    expect(JSON.stringify(summary)).not.toContain("secret-chart");
    expect(JSON.stringify(summary)).not.toContain("super-secret");
    expect(JSON.stringify(summary)).not.toContain("West");
  });

  it("logs grouped redacted payloads when enabled", () => {
    const sink = createConsoleSink();
    const logger = createDevLogger({ enabled: true, sink });

    logger.clientToolSuccess({
      capabilityId: "report-agent",
      fileCount: 3,
      threadId: "thr_789",
      toolName: "render_chart_from_file",
      durationMs: 41,
      effectCount: 1,
      appendedFileCount: 0,
      result: {
        row_count: 2,
        rows: [{ revenue: 100 }],
        imageDataUrl: "data:image/png;base64,secret",
      },
    });

    expect(sink.groupCollapsed).toHaveBeenCalledWith(
      "[chatkit] client_tool.success render_chart_from_file",
    );
    expect(sink.info).toHaveBeenCalledWith({
      capabilityId: "report-agent",
      fileCount: 3,
      threadId: "thr_789",
      toolName: "render_chart_from_file",
      durationMs: 41,
      effectCount: 1,
      appendedFileCount: 0,
      result: {
        resultKeys: ["imageDataUrl", "row_count", "rows"],
        rowCount: 2,
        hasImageDataUrl: true,
      },
    });
  });
});
