import type { CapabilityDemoScenario } from "../types";
import { buildCsvDemoFile, buildPdfDemoFile } from "../shared/demo-fixtures";

const SALES_CSV = `month,region,category,revenue,units
Jan,North,Hardware,120,3
Jan,South,Services,90,2
Feb,North,Software,180,5
Feb,West,Hardware,150,4
Mar,West,Software,210,6
Mar,South,Services,60,1
`;

export async function buildReportAgentDemoScenario(): Promise<CapabilityDemoScenario> {
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
        body: [
          "Reference material and assumptions for the review packet.",
        ],
      },
    ],
  });

  return {
    id: "report-agent-demo",
    title: "Delegated report demo",
    summary: "Use mixed workspace files to investigate, delegate to specialists, and assemble a short stakeholder-ready report update.",
    initialPrompt: [
      "This is the Report Agent demo.",
      "Start by listing the workspace files.",
      "Investigate the sales CSV, create one useful chart through the right specialist flow, inspect the PDF packet if it helps, and append a short report section summarizing the key takeaway.",
      "Treat this as a batch-style demo: infer reasonable defaults, continue without asking me follow-up questions, and show the completed result.",
      "Do not stop until you have used append_report_section to add a useful report update.",
      "Do not stop after one tool call.",
    ].join(" "),
    workspaceSeed: [
      buildCsvDemoFile("demo-report-sales", "board_sales_demo.csv", SALES_CSV),
      sourcePdf,
    ],
    defaultExecutionMode: "batch",
    model: "lightweight",
    expectedOutcomes: [
      "Delegates specialized work instead of doing everything in one prompt",
      "Produces at least one visible specialist effect",
      "Appends a short report section at the end",
    ],
    notes: [
      "This is the most complete demo and is intended to be the easiest boss-click path.",
    ],
  };
}
