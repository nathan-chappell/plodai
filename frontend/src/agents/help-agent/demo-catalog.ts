import type { LocalWorkspaceFile } from "../../types/report";
import { buildCsvDemoFile, buildPdfDemoFile } from "../shared/demo-fixtures";

export type HelpDemoScenario = {
  id: string;
  title: string;
  summary: string;
  workspace_name: string;
  target_agent_id: "report-agent" | "document-agent";
  seed_files: LocalWorkspaceFile[];
  initial_prompt: string;
  suggested_prompts: string[];
  model?: string;
};

const SALES_CSV = `month,region,category,revenue,units
Jan,North,Hardware,120,3
Jan,South,Services,90,2
Feb,North,Software,180,5
Feb,West,Hardware,150,4
Mar,West,Software,210,6
Mar,South,Services,60,1
`;

async function buildReportDemoScenario(): Promise<HelpDemoScenario> {
  const sourcePdf = await buildPdfDemoFile({
    id: "demo-board-pack",
    name: "board_pack_demo.pdf",
    pages: [
      {
        title: "Board Overview",
        body: [
          "This page introduces the quarterly business review for leadership.",
          "Use it to demonstrate PDF inspection and downstream narrative reporting.",
        ],
      },
      {
        title: "Market Performance",
        body: [
          "West region revenue accelerated and software closed the quarter strongly.",
          "The underlying sales CSV should support one simple summary chart.",
        ],
      },
      {
        title: "Appendix",
        body: ["Reference material and assumptions for the review packet."],
      },
    ],
  });

  return {
    id: "report-demo",
    title: "Report walkthrough",
    summary:
      "Investigate mixed files, delegate the tabular work, render one chart, and save a compact report slide.",
    workspace_name: "Report demo",
    target_agent_id: "report-agent",
    seed_files: [
      buildCsvDemoFile("demo-report-sales", "board_sales_demo.csv", SALES_CSV),
      sourcePdf,
    ],
    initial_prompt: [
      "Start the report demo in this seeded workspace.",
      "List the reports and reuse the current report if one already exists.",
      "Delegate the sales CSV work to the appropriate specialist flow.",
      "Use dataset_id demo-report-sales to create exactly one grouped dataset by region with summed revenue, sorted descending.",
      "Then render exactly one useful bar chart from that derived dataset.",
      "After the chart exists, append exactly one 1x2 slide with the chart first and a short stakeholder-ready summary second.",
      "Do not stop until the derived dataset, chart, and saved report slide all exist.",
    ].join(" "),
    suggested_prompts: [
      "Start the report demo.",
      "Explain what the report demo is trying to show me.",
      "Summarize what just happened in this report demo workspace.",
    ],
    model: "lightweight",
  };
}

async function buildDocumentDemoScenario(): Promise<HelpDemoScenario> {
  return {
    id: "document-demo",
    title: "Document walkthrough",
    summary:
      "Inspect a realistic PDF, explain its structure, and produce a useful smart split with packaged outputs.",
    workspace_name: "Document demo",
    target_agent_id: "document-agent",
    seed_files: [
      await buildPdfDemoFile({
        id: "demo-quarterly-packet",
        name: "quarterly_packet_demo.pdf",
        pages: [
          {
            title: "Executive Summary",
            body: ["Quarterly review summary for leadership and board preparation."],
          },
          {
            title: "Regional Performance",
            body: ["Revenue trends by region with a short discussion of the west acceleration."],
          },
          {
            title: "Operations",
            body: ["Operational notes, open risks, and follow-up actions for the quarter."],
          },
          {
            title: "Appendix",
            body: ["Supporting details and references."],
          },
        ],
      }),
    ],
    initial_prompt: [
      "Start the document demo in this seeded workspace.",
      "List the PDF files and inspect the available packet before deciding how to split it.",
      "Explain what the packet appears to be in one concise sentence.",
      "Then create a smart split that separates the useful sections, adds an index, and packages the result.",
      "Keep going until the split outputs and packaged result actually exist.",
    ].join(" "),
    suggested_prompts: [
      "Start the document demo.",
      "Explain what the document demo is meant to show.",
      "Summarize the smart split result in this demo workspace.",
    ],
    model: "lightweight",
  };
}

let demoCatalogPromise: Promise<HelpDemoScenario[]> | null = null;

export async function listHelpDemoScenarios(): Promise<HelpDemoScenario[]> {
  if (!demoCatalogPromise) {
    demoCatalogPromise = Promise.all([
      buildReportDemoScenario(),
      buildDocumentDemoScenario(),
    ]);
  }
  return demoCatalogPromise;
}

export async function getHelpDemoScenario(
  scenarioId: string,
): Promise<HelpDemoScenario | null> {
  const scenarios = await listHelpDemoScenarios();
  return scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
}

export function summarizeHelpDemoScenario(
  scenario: HelpDemoScenario,
): Record<string, unknown> {
  return {
    id: scenario.id,
    title: scenario.title,
    summary: scenario.summary,
    workspace_name: scenario.workspace_name,
    target_agent_id: scenario.target_agent_id,
    seed_file_count: scenario.seed_files.length,
    suggested_prompts: scenario.suggested_prompts,
  };
}
