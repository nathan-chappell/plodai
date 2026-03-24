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
    workspaceId: "workspace-plodai",
    workspaceName: "PlodAI workspace",
    activeThreadId: null,
    activeAgentId: "plodai-agent",
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
  it("builds the plodai dependency graph without a default router agent", () => {
    expect(agentIdsFor("plodai-agent")).toEqual([
      "plodai-agent",
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
    expect(getAgentModule("plodai-agent")?.definition.path).toBe("/plodai");
    expect(getAgentModule("document-agent")?.definition.path).toBe("/documents");
    expect(getAgentModule("missing-agent")).toBeNull();
  });

  it("binds unique client tools across the plodai bundle", () => {
    const workspace = createWorkspaceContext();
    const toolNames = bindClientToolsForAgentBundle(
      buildAgentBundleForRoot("plodai-agent", workspace),
      workspace,
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
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
    expect(toolNames).not.toContain("list_image_files");
    expect(toolNames).not.toContain("inspect_image_file");
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });

  it("uses attachment-first plodai instructions without the removed image tools", () => {
    const workspace = createWorkspaceContext();
    const agentSpec = getAgentModule("plodai-agent")?.buildAgentSpec(workspace);
    const instructions = agentSpec?.instructions;

    expect(agentSpec?.agent_name).toBe("PlodAI");
    expect(instructions).toContain("You are PlodAI.");
    expect(instructions).toContain("Treat images attached to the user's message as primary evidence.");
    expect(instructions).toContain("Treat the saved farm record as your durable notes for this workspace.");
    expect(instructions).toContain("When you learn any new or important durable fact, call `get_farm_state`");
    expect(instructions).toContain("always provide a concrete `farm_name`");
    expect(instructions).toContain("Farm naming order is:");
    expect(instructions).toContain("keep it stable unless the user explicitly asks to rename it.");
    expect(instructions).toContain("`savjetodavna.mps.hr`");
    expect(instructions).toContain("`poljoprivreda.gov.hr`");
    expect(instructions).toContain("`aphis.usda.gov`");
    expect(instructions).toContain("`food.ec.europa.eu`");
    expect(instructions).toContain("`eur-lex.europa.eu`");
    expect(instructions).toContain("`hr.wikipedia.org` or `wikipedia.org`");
    expect(instructions).toContain("Save by default after useful assessments.");
    expect(instructions).toContain("Save partial but grounded findings too.");
    expect(instructions).toContain("put visible problems, seasonal work, plans, and nuance into `notes` for now.");
    expect(instructions).toContain("seasonal needs as of");
    expect(instructions).toContain("Do not ask for permission first.");
    expect(instructions).toContain("Briefly tell the user that the farm record was updated.");
    expect(instructions).toContain("Only create or revise a saved report when the user asks for a reusable deliverable.");
    expect(instructions).not.toContain("list_image_files");
    expect(instructions).not.toContain("inspect_image_file");
    expect(instructions).not.toContain("allowed domains configured for this agent");
    expect(instructions).not.toContain("orchard history");
  });

  it("uses direct chart rendering instructions without make_plan", () => {
    const workspace = createWorkspaceContext();
    const agentSpec = getAgentModule("chart-agent")?.buildAgentSpec(workspace);
    const instructions = agentSpec?.instructions;

    expect(agentSpec?.agent_name).toBe("Charts");
    expect(instructions).toContain("Start with `list_datasets`.");
    expect(instructions).toContain("continue directly to `render_chart_from_dataset`");
    expect(instructions).not.toContain("make_plan");
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
      "append_document_appendix_from_dataset",
      "merge_document_files",
      "smart_split_document",
      "delete_document_file",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });
});
