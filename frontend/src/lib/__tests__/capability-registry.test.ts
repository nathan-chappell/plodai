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
  return buildCapabilityBundleForRoot(rootCapabilityId, createWorkspaceContext()).capabilities.map(
    (capability) => capability.capability_id,
  );
}

function createWorkspaceContext(
  activePrefix: string = "/report-agent/",
): CapabilityWorkspaceContext {
  const filesystem = createWorkspaceFilesystem();
  const workspaceContext = {
    path_prefix: activePrefix,
    referenced_item_ids: [],
  };

  return {
    activePrefix,
    cwdPath: activePrefix,
    files: [],
    entries: [],
    workspaceContext,
    setActivePrefix: () => {},
    createDirectory: (path) => path,
    changeDirectory: (path) => path,
    updateFilesystem: () => {},
    getState: () => ({
      activePrefix,
      cwdPath: activePrefix,
      files: [],
      entries: [],
      filesystem,
      workspaceContext,
    }),
  };
}

describe("capability registry", () => {
  it("returns the expected dependency graph for the report agent", () => {
    expect(capabilityIdsFor("report-agent")).toEqual([
      "report-agent",
      "csv-agent",
      "chart-agent",
      "feedback-agent",
      "pdf-agent",
    ]);
  });

  it("returns the expected dependency graph for the csv agent", () => {
    expect(capabilityIdsFor("csv-agent")).toEqual(["csv-agent", "chart-agent", "feedback-agent"]);
  });

  it("returns standalone bundles for chart and pdf agents", () => {
    expect(capabilityIdsFor("chart-agent")).toEqual(["chart-agent", "feedback-agent"]);
    expect(capabilityIdsFor("pdf-agent")).toEqual(["pdf-agent", "feedback-agent"]);
  });

  it("exposes capability modules by id", () => {
    expect(getCapabilityModule("report-agent")?.definition.path).toBe("/capabilities/report-agent");
    expect(getCapabilityModule("missing-agent")).toBeNull();
  });

  it("keeps the root report agent limited to report CRUD tools", () => {
    const workspace = createWorkspaceContext();
    const bundle = buildCapabilityBundleForRoot("report-agent", workspace);
    const rootSpec = bundle.capabilities.find(
      (capability) => capability.capability_id === "report-agent",
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
      buildCapabilityBundleForRoot("report-agent", workspace),
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
