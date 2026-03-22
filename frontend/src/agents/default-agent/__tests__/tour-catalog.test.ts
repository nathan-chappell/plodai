// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDefaultTourPickerDisplaySpec,
  getDefaultTourScenario,
  listDefaultTourScenarios,
  loadDefaultTourScenarioDefaultFiles,
  resetDefaultTourCatalogForTests,
} from "../tour-catalog";

describe("default-agent tour catalog", () => {
  beforeEach(() => {
    resetDefaultTourCatalogForTests();
    vi.restoreAllMocks();
  });

  it("lists only the visible guided tours without loading default assets eagerly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const scenarios = await listDefaultTourScenarios();

    expect(scenarios).toEqual([
      {
        id: "report-tour",
        title: "Report tour",
        summary:
          "Bring your own reporting inputs or use the built-in default pack, then create one chart-backed report slide.",
        workspace_name: "Report tour",
        target_agent_id: "report-agent",
        default_asset_count: 2,
        suggested_prompts: [
          "Start the report tour.",
          "Explain what the report tour is meant to show.",
          "Summarize what the report tour produced.",
        ],
      },
      {
        id: "document-tour",
        title: "Document tour",
        summary:
          "Bring your own PDF or use the built-in default packet, then inspect it and produce a useful smart split.",
        workspace_name: "Document tour",
        target_agent_id: "document-agent",
        default_asset_count: 1,
        suggested_prompts: [
          "Start the document tour.",
          "Explain what the document tour is meant to show.",
          "Summarize the smart split result from this tour.",
        ],
      },
    ]);
    expect(scenarios.some((scenario) => scenario.id === "walnut-orchard-tour")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns launch metadata for the report tour without resolving files yet", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const scenario = await getDefaultTourScenario("report-tour");

    expect(scenario).toEqual({
      id: "report-tour",
      title: "Report tour",
      summary:
        "Bring your own reporting inputs or use the built-in default pack, then create one chart-backed report slide.",
      workspace_name: "Report tour",
      target_agent_id: "report-agent",
      upload_config: {
        accept: {
          "text/csv": [".csv"],
          "application/json": [".json"],
          "text/plain": [".txt", ".md"],
          "application/pdf": [".pdf"],
        },
        max_count: 4,
        helper_text:
          "Upload one or more reporting inputs. A CSV plus an optional supporting PDF works best, but the tour should continue with whatever useful evidence is available.",
      },
      default_assets: [
        {
          public_path: "/tours/report/board_sales.csv",
          file_name: "board_sales.csv",
          mime_type: "text/csv",
        },
        {
          public_path: "/tours/report/board_pack.pdf",
          file_name: "board_pack.pdf",
          mime_type: "application/pdf",
        },
      ],
      launch_prompt: expect.stringContaining(
        "If only part of the ideal input mix is present, continue with the available evidence",
      ),
      suggested_prompts: [
        "Start the report tour.",
        "Explain what the report tour is meant to show.",
        "Summarize what the report tour produced.",
      ],
      model: "lightweight",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds the tour-picker display metadata used by the capabilities bundle", () => {
    expect(buildDefaultTourPickerDisplaySpec()).toEqual({
      title: "Choose a guided tour",
      summary:
        "Pick the guided sample that best fits your goal. The launcher will open next so you can use your own files or the built-in default pack.",
      scenarios: [
        {
          scenario_id: "report-tour",
          title: "Report tour",
          summary:
            "Bring your own reporting inputs or use the built-in default pack, then create one chart-backed report slide.",
          workspace_name: "Report tour",
          target_agent_id: "report-agent",
          default_asset_count: 2,
        },
        {
          scenario_id: "document-tour",
          title: "Document tour",
          summary:
            "Bring your own PDF or use the built-in default packet, then inspect it and produce a useful smart split.",
          workspace_name: "Document tour",
          target_agent_id: "document-agent",
          default_asset_count: 1,
        },
      ],
    });
  });

  it("loads the built-in default files through fetch only when requested", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response("region,revenue\nWest,120\n", {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
          },
        }),
      );

    const files = await loadDefaultTourScenarioDefaultFiles("report-tour");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/tours/report/board_sales.csv");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/tours/report/board_pack.pdf");
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      name: "board_sales.csv",
      type: "text/csv",
    });
    expect(files[1]).toMatchObject({
      name: "board_pack.pdf",
      type: "application/pdf",
    });
  });
});
