import { describe, expect, it } from "vitest";

import {
  buildWorkspaceStateMetadata,
  ensureWorkspaceContractFilesystem,
  writeAgentsFile,
} from "../workspace-contract";
import { createWorkspaceFilesystem } from "../workspace-fs";

describe("workspace contract metadata", () => {
  it("includes workspace AGENTS markdown in thread metadata without exposing it as a visible file", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "csv-agent",
      capabilityTitle: "CSV Agent",
      defaultGoal: "Inspect sales trends.",
      activeWorkspaceTab: "agent",
      executionMode: "interactive",
    });

    filesystem = writeAgentsFile(
      filesystem,
      "# AGENTS.md\n\n## Workspace conventions\n- Prefer compact artifact names.\n",
    );

    const metadata = buildWorkspaceStateMetadata(filesystem, "/csv-agent/");

    expect(metadata.agents_markdown).toContain("Prefer compact artifact names.");
    expect(metadata.files.find((file) => file.path === "/AGENTS.md")).toBeUndefined();
  });
});
