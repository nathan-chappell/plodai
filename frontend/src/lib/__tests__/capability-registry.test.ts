import { describe, expect, it } from "vitest";

import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  getCapabilityModule,
  listCapabilityBundleToolNames,
} from "../../capabilities/registry";
import { createWorkspaceFilesystem } from "../workspace-fs";
import type { CapabilityWorkspaceContext } from "../../capabilities/types";

function capabilityIdsFor(rootCapabilityId: string): string[] {
  return buildCapabilityBundleForRoot(rootCapabilityId, createWorkspaceContext()).tool_providers.map(
    (toolProvider) => toolProvider.tool_provider_id,
  );
}

function createWorkspaceContext(
  workspaceId: string = "workspace-default",
): CapabilityWorkspaceContext {
  const filesystem = createWorkspaceFilesystem();
  const workspaceContext = {
    workspace_id: workspaceId,
    referenced_item_ids: [],
  };

  return {
    capabilityId: "workspace-agent",
    capabilityTitle: "Workspace",
    workspaceId,
    files: [],
    entries: [],
    workspaceContext,
    updateFilesystem: () => {},
    getState: () => ({
      workspaceId,
      files: [],
      entries: [],
      filesystem,
      workspaceContext,
    }),
  };
}

describe("capability registry", () => {
  it("returns the expected dependency graph for the workspace agent", () => {
    expect(capabilityIdsFor("workspace-agent")).toEqual([
      "workspace-agent",
      "report-agent",
      "data-agent",
      "csv-agent",
      "feedback-agent",
      "chart-agent",
      "pdf-agent",
    ]);
  });

  it("returns the expected dependency graph for the report agent", () => {
    expect(capabilityIdsFor("report-agent")).toEqual([
      "report-agent",
      "data-agent",
      "csv-agent",
      "feedback-agent",
      "chart-agent",
      "pdf-agent",
    ]);
  });

  it("returns the expected dependency graph for the data agent", () => {
    expect(capabilityIdsFor("data-agent")).toEqual([
      "data-agent",
      "csv-agent",
      "feedback-agent",
      "chart-agent",
    ]);
  });

  it("returns standalone bundles for chart and pdf agents", () => {
    expect(capabilityIdsFor("chart-agent")).toEqual(["chart-agent", "feedback-agent"]);
    expect(capabilityIdsFor("pdf-agent")).toEqual(["pdf-agent", "feedback-agent"]);
  });

  it("exposes capability modules by id", () => {
    expect(getCapabilityModule("workspace-agent")?.definition.path).toBe("/workspace");
    expect(getCapabilityModule("missing-agent")).toBeNull();
  });

  it("keeps the root report agent limited to report CRUD tools", () => {
    const workspace = createWorkspaceContext();
    const bundle = buildCapabilityBundleForRoot("report-agent", workspace);
    const rootSpec = bundle.tool_providers.find(
      (toolProvider) => toolProvider.tool_provider_id === "report-agent",
    );

    expect(rootSpec?.client_tools.map((tool) => tool.name)).toEqual([
      "list_reports",
      "get_report",
      "create_report",
      "append_report_slide",
      "remove_report_slide",
    ]);
  });

  it("binds unique tools across delegated capability bundles", () => {
    const workspace = createWorkspaceContext();
    const toolNames = bindClientToolsForBundle(
      buildCapabilityBundleForRoot("workspace-agent", workspace),
      workspace,
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_reports",
      "append_report_slide",
      "list_csv_files",
      "list_chartable_files",
      "list_pdf_files",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });

  it("lists unique tool names declared across bundle dependencies", () => {
    const toolNames = listCapabilityBundleToolNames(
      buildCapabilityBundleForRoot("chart-agent", createWorkspaceContext()),
    );

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_chartable_files",
      "inspect_chartable_file_schema",
      "render_chart_from_file",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });
});
