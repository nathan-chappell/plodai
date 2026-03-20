import { buildCsvAgentDemoScenario } from "../csv-agent/demo";
import type { ToolProviderDemoScenario } from "../types";

export async function buildDataAgentDemoScenario(): Promise<ToolProviderDemoScenario> {
  const csvScenario = await buildCsvAgentDemoScenario();
  return {
    ...csvScenario,
    id: "data-agent-demo",
    title: "Data investigation demo",
    summary:
      "Investigate bundled data files, create one reusable artifact, and if the story should be visualized, follow through until a real chart render exists.",
    initialPrompt: [
      "This is the Data tool demo.",
      "Start by routing the tabular work to the CSV specialist.",
      "Create exactly one reusable data artifact from a safe grouped aggregate query.",
      "If a chart helps the story, continue the flow through the chart specialist until a real rendered chart exists in the thread.",
      "Do not stop after a plan, schema inspection, or delegation widget.",
      "Explain the business takeaway briefly when you are done.",
    ].join(" "),
    expectedOutcomes: [
      "Routes tabular analysis through the CSV specialist",
      "Creates one reusable data artifact",
      "If it chooses the chart path, the run includes a real chart render before completion",
    ],
    notes: [
      "This demo presents CSV analysis and chart follow-through as one public data workflow.",
    ],
  };
}
