import type { CapabilityDemoScenario } from "../types";
import { buildJsonDemoFile } from "../shared/demo-fixtures";

const REVENUE_JSON = JSON.stringify(
  [
    { month: "Jan", region: "North", revenue: 120 },
    { month: "Jan", region: "South", revenue: 90 },
    { month: "Feb", region: "North", revenue: 180 },
    { month: "Feb", region: "West", revenue: 150 },
    { month: "Mar", region: "West", revenue: 210 },
    { month: "Mar", region: "South", revenue: 60 },
  ],
  null,
  2,
);

export async function buildChartAgentDemoScenario(): Promise<CapabilityDemoScenario> {
  return {
    id: "chart-agent-demo",
    title: "Chart storytelling demo",
    summary: "Inspect a chartable JSON artifact, make a plan first, and render the clearest chart for explaining the revenue pattern.",
    initialPrompt: [
      "This is the Chart Agent demo.",
      "List the chartable files and inspect the available artifact schema.",
      "Make a plan before rendering.",
      "Then create one beautiful chart that best explains the revenue pattern across the available dimensions, and briefly explain why that chart is the right choice.",
    ].join(" "),
    workspaceSeed: [
      buildJsonDemoFile("demo-chartable-revenue", "regional_revenue_demo.json", REVENUE_JSON),
    ],
    model: "lightweight",
    expectedOutcomes: [
      "Inspects the chartable artifact before rendering",
      "Calls make_plan before render_chart_from_file",
      "Produces one polished chart effect",
    ],
    notes: [
      "This demo is tuned to showcase the plan-first chart flow and the Chart.js presentation layer.",
    ],
  };
}
