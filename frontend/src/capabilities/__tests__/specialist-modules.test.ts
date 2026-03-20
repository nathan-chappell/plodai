import { describe, expect, it } from "vitest";

import type { CapabilityWorkspaceContext } from "../types";
import chartAgentModule from "../chart-agent";
import csvAgentModule from "../csv-agent";
import pdfAgentModule from "../pdf-agent";
import { createWorkspaceFilesystem } from "../../lib/workspace-fs";

function createWorkspace(): CapabilityWorkspaceContext {
  return {
    capabilityId: "workspace-agent",
    capabilityTitle: "Workspace",
    workspaceId: "workspace-default",
    files: [],
    entries: [],
    workspaceContext: {
      workspace_id: "workspace-default",
      referenced_item_ids: [],
    },
    updateFilesystem: () => {},
    getState: () => ({
      workspaceId: "workspace-default",
      files: [],
      entries: [],
      filesystem: createWorkspaceFilesystem(),
      workspaceContext: {
        workspace_id: "workspace-default",
        referenced_item_ids: [],
      },
    }),
  };
}

describe("specialist agent modules", () => {
  it("tell the specialists to ask one concise clarifying question only when needed", () => {
    const workspace = createWorkspace();

    for (const module of [csvAgentModule, chartAgentModule, pdfAgentModule]) {
      const instructions = module.buildAgentSpec(workspace).instructions;
      expect(instructions).toContain("ask one concise clarifying question early");
      expect(instructions).toContain("asking repeated follow-ups");
    }
  });
});
