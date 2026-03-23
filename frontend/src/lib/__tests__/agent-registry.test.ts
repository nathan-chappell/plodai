import { describe, expect, it } from "vitest";

import {
  bindClientToolsForAgentBundle,
  buildAgentBundleForRoot,
  getAgentModule,
  listAgentBundleToolNames,
} from "../../agents/registry";
import type { AgentRuntimeContext } from "../../agents/types";

function createWorkspaceContext(): AgentRuntimeContext {
  return {
    workspaceId: "workspace-agriculture",
    workspaceName: "Agriculture workspace",
    activeAgentId: "agriculture-agent",
    selectedFileId: null,
    selectedArtifactId: null,
    currentReportArtifactId: null,
    listFiles: () => [],
    getFile: () => null,
    resolveLocalFile: async () => null,
    registerFile: async () => {
      throw new Error("registerFile is not used in this test.");
    },
    removeFile: async () => undefined,
    listArtifacts: () => [],
    getArtifact: async () => null,
    listArtifactRevisions: async () => [],
    createArtifact: async () => {
      throw new Error("createArtifact is not used in this test.");
    },
    applyArtifactOperation: async () => {
      throw new Error("applyArtifactOperation is not used in this test.");
    },
    updateWorkspace: async () => null,
  };
}

function agentIdsFor(rootAgentId: string): string[] {
  return buildAgentBundleForRoot(rootAgentId, createWorkspaceContext()).agents.map(
    (agent) => agent.agent_id,
  );
}

describe("agent registry", () => {
  it("builds the agriculture dependency graph without a default router agent", () => {
    expect(agentIdsFor("agriculture-agent")).toEqual([
      "agriculture-agent",
      "analysis-agent",
      "chart-agent",
      "feedback-agent",
      "document-agent",
    ]);
  });

  it("keeps the document bundle compact", () => {
    expect(agentIdsFor("document-agent")).toEqual([
      "document-agent",
      "feedback-agent",
    ]);
  });

  it("exposes only the live app modules by their updated routes", () => {
    expect(getAgentModule("agriculture-agent")?.definition.path).toBe("/agriculture");
    expect(getAgentModule("document-agent")?.definition.path).toBe("/documents");
    expect(getAgentModule("missing-agent")).toBeNull();
  });

  it("binds unique client tools across the agriculture bundle", () => {
    const workspace = createWorkspaceContext();
    const toolNames = bindClientToolsForAgentBundle(
      buildAgentBundleForRoot("agriculture-agent", workspace),
      workspace,
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_image_files",
      "inspect_image_file",
      "get_farm_state",
      "save_farm_state",
      "list_reports",
      "get_report",
      "create_report",
      "append_report_slide",
      "remove_report_slide",
      "list_datasets",
      "inspect_dataset_schema",
      "run_aggregate_query",
      "create_dataset",
      "render_chart_from_dataset",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });

  it("lists unique tool names declared across the document bundle", () => {
    const toolNames = listAgentBundleToolNames(
      buildAgentBundleForRoot("document-agent", createWorkspaceContext()),
    );

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_document_files",
      "inspect_document_file",
      "replace_document_text",
      "fill_document_form",
      "update_document_visual_from_dataset",
      "append_document_appendix_from_dataset",
      "smart_split_document",
      "delete_document_file",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });
});
