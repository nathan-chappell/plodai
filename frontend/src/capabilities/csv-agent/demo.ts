import type { CapabilityDemoScenario } from "../types";
import { buildCsvDemoFile } from "../shared/demo-fixtures";

const SALES_CSV = `month,region,category,revenue,units
Jan,North,Hardware,120,3
Jan,South,Services,90,2
Feb,North,Software,180,5
Feb,West,Hardware,150,4
Mar,West,Software,210,6
Mar,South,Services,60,1
`;

const SUPPORT_CSV = `month,region,tickets_open,csat
Jan,North,12,4.6
Feb,South,19,4.1
Mar,West,8,4.8
`;

export async function buildCsvAgentDemoScenario(): Promise<CapabilityDemoScenario> {
  return {
    id: "csv-agent-demo",
    title: "Revenue investigation demo",
    summary:
      "Inspect two CSVs, summarize the revenue story, create one derived chartable artifact, and if you choose the chart path, do not stop until real chart evidence exists in the thread.",
    initialPrompt: [
      "This is the CSV Agent demo.",
      "Start by listing the workspace files and inspecting the available CSVs.",
      "Investigate the sales data, create one reusable chartable artifact from a safe grouped aggregate query, and if it helps the story, hand off to the Chart Agent for one polished chart.",
      "If you choose the chart path, the run is not complete until render_chart_from_file has actually happened and chart evidence is visible in the thread.",
      "Do not stop after a plan or a handoff widget.",
      "Provide results directly unless you are truly blocked.",
      "Explain the business takeaway briefly when you are done.",
    ].join(" "),
    workspaceSeed: [
      buildCsvDemoFile("demo-sales-fixture", "sales_demo.csv", SALES_CSV),
      buildCsvDemoFile("demo-support-fixture", "support_demo.csv", SUPPORT_CSV),
    ],
    model: "lightweight",
    expectedOutcomes: [
      "Lists the bundled CSV files before analyzing them",
      "Runs a safe grouped aggregate query and creates a derived artifact",
      "If it hands off for a chart, the run includes a real chart render before completion",
    ],
    notes: [
      "This demo is designed to show disciplined CSV investigation rather than raw row dumping.",
    ],
  };
}
