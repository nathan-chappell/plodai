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
      "Start by listing the reports and reuse the current report if one already exists.",
      "Only call create_report if there is no active report yet. Do not create a second report just because you can.",
      "You must delegate the sales CSV work to the right specialist flow.",
      "The sales CSV is available in the workspace as file name board_sales_demo.csv and dataset_id demo-report-sales.",
      "Have the specialist use dataset_id demo-report-sales to create exactly one derived chartable artifact from that CSV using a simple grouped aggregate query: group by region, sum revenue as total_revenue, and sort the result by total_revenue descending.",
      "You must then delegate to the chart specialist and render exactly one useful bar chart from that derived artifact.",
      "After each specialist handoff, control returns to you.",
      "When control returns, check the original demo requirements again and keep going if any required step is still missing.",
      "The demo is not complete until render_chart_from_file has actually happened.",
      "A plan, an inspection step, or a statement that a chart would be helpful does not count.",
      "If the first specialist pass only inspects or plans, continue until the chart is truly rendered and visible in the thread.",
      "Inspect the PDF packet only as supporting context if it helps, not as a replacement for the CSV and chart work.",
      "After the chart is rendered, append exactly one 1x2 report slide with the rendered chart in the first panel and a short stakeholder-ready summary in the second panel.",
      "Infer reasonable defaults, continue without asking follow-up questions, and show the completed result.",
      "Do not stop until you have created the derived artifact, rendered the chart, and used append_report_slide to add the one required chart-backed report update.",
      "After that single report slide is appended, stop.",
      "Your final assistant reply should be brief, confirm the result is complete, and must not offer optional next steps, extra sections, or follow-up questions.",
      "Do not satisfy this task with a PDF-only summary.",
      "Do not stop after one tool call.",
    ].join(" "),
    workspaceSeed: [
      buildCsvDemoFile("demo-report-sales", "board_sales_demo.csv", SALES_CSV),
      sourcePdf,
    ],
    model: "lightweight",
    expectedOutcomes: [
      "Delegates specialized work instead of doing everything in one prompt",
      "Produces at least one visible specialist effect",
      "Appends a short report slide at the end",
    ],
    notes: [
      "This is the most complete demo and is intended to be the easiest boss-click path.",
    ],
  };
}
