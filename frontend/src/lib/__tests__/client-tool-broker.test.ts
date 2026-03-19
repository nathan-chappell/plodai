import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolExecutionResultV1 } from "../../types/tool-runtime";
import type { CapabilityWorkspaceContext } from "../../capabilities/types";
import { createWorkspaceFilesystem, getWorkspaceContext } from "../workspace-fs";

let nextWorkerResult: ToolExecutionResultV1 | null = null;

vi.mock("../client-tools.worker?worker", () => ({
  default: class MockClientToolsWorker {
    onmessage: ((event: MessageEvent<ToolExecutionResultV1>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    postMessage(_request: unknown) {
      if (!this.onmessage || !nextWorkerResult) {
        throw new Error("Mock worker result was not configured.");
      }
      this.onmessage({ data: nextWorkerResult } as MessageEvent<ToolExecutionResultV1>);
    }
  },
}));

import { executeToolWithBroker } from "../client-tool-broker";

function createWorkspace(): CapabilityWorkspaceContext {
  const filesystem = createWorkspaceFilesystem();
  const workspaceContext = getWorkspaceContext(filesystem, "/");
  return {
    activePrefix: "/",
    cwdPath: "/",
    files: [],
    entries: [],
    workspaceContext,
    setActivePrefix: () => {},
    createDirectory: (path) => path,
    changeDirectory: (path) => path,
    updateFilesystem: () => {},
    getState: () => ({
      activePrefix: "/",
      cwdPath: "/",
      files: [],
      entries: [],
      filesystem,
      workspaceContext,
    }),
  };
}

describe("client tool broker", () => {
  beforeEach(() => {
    nextWorkerResult = null;
  });

  it("preserves detailed file metadata from worker tool results", async () => {
    nextWorkerResult = {
      version: "v1",
      request_id: 1,
      tool_name: "list_csv_files",
      payload: {
        path_prefix: "/",
        workspace_context: {
          path_prefix: "/",
          referenced_item_ids: ["sales-current"],
        },
        files: [
          {
            id: "sales-current",
            name: "sales.csv",
            path: "/sales.csv",
            kind: "csv",
            extension: "csv",
            mime_type: "text/csv",
            byte_size: 24,
            row_count: 1,
            columns: ["region", "revenue"],
            numeric_columns: ["revenue"],
            sample_rows: [{ region: "West", revenue: "210" }],
          },
        ],
      },
      mutations: [],
      effects: [],
      warnings: [],
    };

    const result = await executeToolWithBroker(createWorkspace(), "list_csv_files", {});

    expect(result.payload.files).toEqual([
      expect.objectContaining({
        id: "sales-current",
        name: "sales.csv",
        row_count: 1,
        columns: ["region", "revenue"],
        numeric_columns: ["revenue"],
        sample_rows: [{ region: "West", revenue: "210" }],
      }),
    ]);
    expect(result.payload.path_prefix).toBe("/");
  });
});
