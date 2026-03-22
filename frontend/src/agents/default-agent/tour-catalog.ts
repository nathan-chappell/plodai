import type { AgentAttachmentAcceptMap } from "../types";
import type { TourUploadConfig } from "../../types/analysis";

export type DefaultTourTargetAgentId =
  | "report-agent"
  | "document-agent";

export type DefaultTourAsset = {
  public_path: string;
  file_name: string;
  mime_type: string;
};

export type DefaultTourScenario = {
  id: string;
  title: string;
  summary: string;
  workspace_name: string;
  target_agent_id: DefaultTourTargetAgentId;
  upload_config: TourUploadConfig;
  default_assets: DefaultTourAsset[];
  launch_prompt: string;
  suggested_prompts: string[];
  model?: string;
};

export type DefaultTourScenarioSummary = {
  id: string;
  title: string;
  summary: string;
  workspace_name: string;
  target_agent_id: DefaultTourTargetAgentId;
  default_asset_count: number;
  suggested_prompts: string[];
};

export type DefaultTourPickerDisplaySpec = {
  title: string;
  summary: string;
  scenarios: Array<{
    scenario_id: string;
    title: string;
    summary: string;
    workspace_name: string;
    target_agent_id: DefaultTourTargetAgentId;
    default_asset_count: number;
  }>;
};

const REPORT_TOUR_ACCEPT = {
  "text/csv": [".csv"],
  "application/json": [".json"],
  "text/plain": [".txt", ".md"],
  "application/pdf": [".pdf"],
} as const satisfies AgentAttachmentAcceptMap;

const DOCUMENT_TOUR_ACCEPT = {
  "application/pdf": [".pdf"],
} as const satisfies AgentAttachmentAcceptMap;

type DefaultTourScenarioBlueprint = DefaultTourScenario;

function buildReportTourScenarioBlueprint(): DefaultTourScenarioBlueprint {
  return {
    id: "report-tour",
    title: "Report tour",
    summary:
      "Bring your own reporting inputs or use the built-in default pack, then create one chart-backed report slide.",
    workspace_name: "Report tour",
    target_agent_id: "report-agent",
    upload_config: {
      accept: REPORT_TOUR_ACCEPT,
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
    launch_prompt: [
      "Start the report tour in the current workspace.",
      "List the available files and existing reports first.",
      "Use the strongest tabular source to create exactly one reusable grouped dataset and exactly one useful chart.",
      "If a supporting document is present, use it to sharpen the narrative rather than ignoring it.",
      "Reuse the current report if it already fits, or create one if needed.",
      "Finish by appending exactly one 1x2 slide with the chart first and a compact stakeholder-ready summary second.",
      "If only part of the ideal input mix is present, continue with the available evidence instead of asking to restage files.",
    ].join(" "),
    suggested_prompts: [
      "Start the report tour.",
      "Explain what the report tour is meant to show.",
      "Summarize what the report tour produced.",
    ],
    model: "lightweight",
  };
}

function buildDocumentTourScenarioBlueprint(): DefaultTourScenarioBlueprint {
  return {
    id: "document-tour",
    title: "Document tour",
    summary:
      "Bring your own PDF or use the built-in default packet, then inspect it and produce a useful smart split.",
    workspace_name: "Document tour",
    target_agent_id: "document-agent",
    upload_config: {
      accept: DOCUMENT_TOUR_ACCEPT,
      max_count: 1,
      helper_text:
        "Upload a single PDF to inspect and split. The built-in default is a realistic packet if you want a guided sample.",
    },
    default_assets: [
      {
        public_path: "/tours/document/quarterly_packet.pdf",
        file_name: "quarterly_packet.pdf",
        mime_type: "application/pdf",
      },
    ],
    launch_prompt: [
      "Start the document tour in the current workspace.",
      "List the available PDF files and inspect the primary document before deciding how to split it.",
      "Explain what the document appears to be in one concise sentence.",
      "Then create a smart split that separates the most useful sections, adds an index, and packages the result.",
      "Keep going until the split outputs and packaged result actually exist.",
      "Work with whichever uploaded or default PDF is present instead of asking to restage the document.",
    ].join(" "),
    suggested_prompts: [
      "Start the document tour.",
      "Explain what the document tour is meant to show.",
      "Summarize the smart split result from this tour.",
    ],
    model: "lightweight",
  };
}

function buildDefaultTourScenarioBlueprints(): DefaultTourScenarioBlueprint[] {
  return [
    buildReportTourScenarioBlueprint(),
    buildDocumentTourScenarioBlueprint(),
  ];
}

let scenarioBlueprintsCache: DefaultTourScenarioBlueprint[] | null = null;

function getDefaultTourScenarioBlueprints(): DefaultTourScenarioBlueprint[] {
  if (!scenarioBlueprintsCache) {
    scenarioBlueprintsCache = buildDefaultTourScenarioBlueprints();
  }
  return scenarioBlueprintsCache;
}

export async function listDefaultTourScenarios(): Promise<DefaultTourScenarioSummary[]> {
  return getDefaultTourScenarioBlueprints().map(summarizeDefaultTourScenario);
}

export function buildDefaultTourPickerDisplaySpec(): DefaultTourPickerDisplaySpec {
  return {
    title: "Choose a guided tour",
    summary:
      "Pick the guided sample that best fits your goal. The launcher will open next so you can use your own files or the built-in default pack.",
    scenarios: getDefaultTourScenarioBlueprints().map((scenario) => ({
      scenario_id: scenario.id,
      title: scenario.title,
      summary: scenario.summary,
      workspace_name: scenario.workspace_name,
      target_agent_id: scenario.target_agent_id,
      default_asset_count: scenario.default_assets.length,
    })),
  };
}

export async function getDefaultTourScenario(
  scenarioId: string,
): Promise<DefaultTourScenario | null> {
  return (
    getDefaultTourScenarioBlueprints().find((scenario) => scenario.id === scenarioId) ?? null
  );
}

export async function loadDefaultTourScenarioDefaultFiles(
  scenarioId: string,
): Promise<File[]> {
  const scenario = await getDefaultTourScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown tour scenario: ${scenarioId}`);
  }
  return Promise.all(scenario.default_assets.map(loadDefaultAssetAsFile));
}

export function summarizeDefaultTourScenario(
  scenario: DefaultTourScenario,
): DefaultTourScenarioSummary {
  return {
    id: scenario.id,
    title: scenario.title,
    summary: scenario.summary,
    workspace_name: scenario.workspace_name,
    target_agent_id: scenario.target_agent_id,
    default_asset_count: scenario.default_assets.length,
    suggested_prompts: scenario.suggested_prompts,
  };
}

export function resetDefaultTourCatalogForTests(): void {
  scenarioBlueprintsCache = null;
}

async function loadDefaultAssetAsFile(asset: DefaultTourAsset): Promise<File> {
  const response = await fetch(asset.public_path);
  if (!response.ok) {
    throw new Error(`Unable to load built-in tour asset: ${asset.public_path}`);
  }
  const blob = await response.blob();
  const mimeType =
    response.headers.get("content-type")?.trim() ||
    blob.type ||
    asset.mime_type;
  return new File([blob], asset.file_name, {
    type: mimeType,
    lastModified: Date.now(),
  });
}
