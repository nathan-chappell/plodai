import type { CapabilityDemoScenario } from "../types";
import { buildPdfDemoFile } from "../shared/demo-fixtures";

export async function buildPdfAgentDemoScenario(): Promise<CapabilityDemoScenario> {
  const sourcePdf = await buildPdfDemoFile({
    id: "demo-quarterly-packet",
    name: "quarterly_packet_demo.pdf",
    pages: [
      {
        title: "Executive Summary",
        body: [
          "Quarterly performance summary for the regional business.",
          "Revenue accelerated in the West while support quality remained stable.",
          "Use this packet to demonstrate PDF inspection and smart split behavior.",
        ],
      },
      {
        title: "Revenue Highlights",
        body: [
          "North remained stable while West delivered the strongest growth.",
          "Hardware drove early wins and software closed the quarter strongly.",
        ],
      },
      {
        title: "Operations Notes",
        body: [
          "Support ticket volume increased in the South in February.",
          "Customer satisfaction recovered by March after staffing adjustments.",
        ],
      },
      {
        title: "Appendix",
        body: [
          "Additional notes, assumptions, and source references.",
          "This final page should make the smart split more visually obvious.",
        ],
      },
    ],
  });

  return {
    id: "pdf-agent-demo",
    title: "Smart split PDF demo",
    summary: "Inspect a multi-page PDF, identify useful structure, and produce a smart split with derived files and an archive.",
    initialPrompt: [
      "This is the PDF Agent demo.",
      "Start by listing the workspace files and inspecting the PDF.",
      "Then perform a smart split that creates useful sub-documents, an index, and an archive for download.",
      "If the document clearly has section boundaries, split by section instead of relying on evenly sized chunks.",
      "Treat this as a batch-style demo and keep moving without asking me follow-up questions unless you are genuinely blocked.",
      "Briefly explain how you chose the split.",
    ].join(" "),
    workspaceSeed: [sourcePdf],
    defaultExecutionMode: "batch",
    model: "lightweight",
    expectedOutcomes: [
      "Inspects the PDF before attempting a split",
      "Produces smart-split output files and an archive",
      "Shows a clear explanation of the chosen decomposition",
    ],
    notes: [
      "This demo is optimized to show PDF inspection, smart split, and workspace file creation in one click.",
    ],
  };
}
