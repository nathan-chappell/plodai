import { describe, expect, it } from "vitest";

import {
  addWorkspaceArtifactsWithResult,
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
  listAllWorkspaceFileNodes,
  removeWorkspaceEntry,
} from "../workspace-fs";
import type { LocalWorkspaceFile } from "../../types/report";

const SAMPLE_FILE: LocalWorkspaceFile = {
  id: "file-1",
  name: "sales.csv",
  kind: "csv",
  extension: "csv",
  byte_size: 12,
  mime_type: "text/csv",
  row_count: 1,
  columns: ["region"],
  numeric_columns: [],
  sample_rows: [{ region: "west" }],
  rows: [{ region: "west" }],
  preview_rows: [{ region: "west" }],
};

describe("workspace filesystem", () => {
  it("starts from an empty artifact catalog", () => {
    const filesystem = createWorkspaceFilesystem();

    expect(filesystem.artifacts_by_id).toEqual({});
    expect(listAllWorkspaceFileNodes(filesystem)).toEqual([]);
  });

  it("writes uploaded files into the uploaded bucket and dedupes sibling names", () => {
    const first = addWorkspaceFilesWithResult(
      createWorkspaceFilesystem(),
      [SAMPLE_FILE],
      "uploaded",
      {
        bucket: "uploaded",
        producer_key: "uploaded",
        producer_label: "Uploaded",
      },
    );
    const second = addWorkspaceFilesWithResult(
      first.filesystem,
      [{ ...SAMPLE_FILE, id: "file-2" }],
      "uploaded",
      {
        bucket: "uploaded",
        producer_key: "uploaded",
        producer_label: "Uploaded",
      },
    );

    const entryNames = listAllWorkspaceFileNodes(second.filesystem).map((entry) => entry.name);

    expect(first.files[0].name).toBe("sales.csv");
    expect(second.files[0].name).toBe("sales (2).csv");
    expect(entryNames).toEqual(["sales (2).csv", "sales.csv"]);
  });

  it("supports explicit artifact metadata for derived files", () => {
    const result = addWorkspaceArtifactsWithResult(createWorkspaceFilesystem(), [
      {
        file: SAMPLE_FILE,
        source: "derived",
        bucket: "data",
        producer_key: "csv-agent",
        producer_label: "CSV Agent",
      },
    ]);

    expect(listAllWorkspaceFileNodes(result.filesystem)).toEqual([
      expect.objectContaining({
        bucket: "data",
        producer_key: "csv-agent",
        producer_label: "CSV Agent",
        source: "derived",
        name: "sales.csv",
      }),
    ]);
  });

  it("removes artifacts cleanly and keeps workspace context in sync", () => {
    const result = addWorkspaceFilesWithResult(
      createWorkspaceFilesystem(),
      [SAMPLE_FILE],
      "demo",
      {
        bucket: "uploaded",
        producer_key: "uploaded",
        producer_label: "Uploaded",
      },
    );
    const fileId = result.files[0]?.id ?? "";
    const pruned = removeWorkspaceEntry(result.filesystem, fileId);

    expect(getWorkspaceContext(result.filesystem, "demo")).toEqual({
      workspace_id: "demo",
      referenced_item_ids: [fileId],
    });
    expect(getWorkspaceContext(pruned, "demo")).toEqual({
      workspace_id: "demo",
      referenced_item_ids: [],
    });
  });
});
