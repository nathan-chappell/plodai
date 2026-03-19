import { describe, expect, it } from "vitest";

import {
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  ensureDirectoryPath,
  listDirectoryEntries,
  normalizeAbsolutePath,
  resolveWorkspacePath,
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
  it("normalizes root-safe absolute paths", () => {
    expect(normalizeAbsolutePath("/reports/./2026")).toBe("/reports/2026");
    expect(() => normalizeAbsolutePath("/../../escape")).toThrow("escape the root");
  });

  it("resolves relative paths from cwd", () => {
    expect(resolveWorkspacePath("charts", "/reports")).toBe("/reports/charts");
    expect(resolveWorkspacePath("../shared", "/reports/2026")).toBe("/reports/shared");
  });

  it("returns synthetic directories without persisting directory entries", () => {
    const initial = createWorkspaceFilesystem();
    const first = ensureDirectoryPath(initial, "/reports/2026");
    const second = ensureDirectoryPath(first.filesystem, "/reports/2026");

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(first.directory.id).toBe("dir:/reports/2026");
    expect(second.directory.path).toBe("/reports/2026");
    expect(listDirectoryEntries(second.filesystem, "/reports/2026")).toEqual([]);
  });

  it("writes uploaded files into the current directory and dedupes sibling names", () => {
    const initial = ensureDirectoryPath(createWorkspaceFilesystem(), "/reports").filesystem;
    const first = addWorkspaceFilesWithResult(initial, "/reports", [SAMPLE_FILE], "uploaded");
    const second = addWorkspaceFilesWithResult(first.filesystem, "/reports", [SAMPLE_FILE], "uploaded");
    const entryNames = listDirectoryEntries(second.filesystem, "/reports").map((entry) => entry.name);

    expect(first.files[0].name).toBe("sales.csv");
    expect(second.files[0].name).toBe("sales (2).csv");
    expect(entryNames).toEqual(["sales (2).csv", "sales.csv"]);
  });
});
