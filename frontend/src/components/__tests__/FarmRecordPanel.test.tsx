import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FarmRecordPanel } from "../FarmRecordPanel";
import type { AdvisoryRecordPayload } from "../../types/advisory";

const SAMPLE_FARM: AdvisoryRecordPayload = {
  version: "v2",
  title: "North Field",
  profile_description: "Mixed vegetables for the spring CSA.",
  default_location: "River Road",
  subjects: [
    {
      id: "subject_1",
      name: "Chestnuts",
      kind: "crop",
      type: "tree_nuts",
      location: "Upper block",
      description: "Main production rows.",
      quantity: "2 beds",
      status: "active",
      notes: "Pruned this month. Expected yield approx. 40 heads.",
    },
  ],
  reports: [
    {
      id: "report_1",
      category: "disease",
      title: "Blight pressure",
      description: "Scattered lesions on the outer canopy.",
      status: "monitoring",
      severity: "high",
      recommended_follow_up: "Inspect again by 2026-04-10.",
      subject_ids: ["subject_1"],
      evidence_image_ids: [],
      measurement_ids: ["measurement_1"],
    },
  ],
  queries: [
    {
      id: "query_1",
      category: "input_sourcing",
      question: "Where can I source materials?",
      status: "open",
      source_urls: [],
      subject_ids: ["subject_1"],
      report_ids: ["report_1"],
      measurement_ids: [],
    },
  ],
  measurements: [
    {
      id: "measurement_1",
      label: "Affected canopy",
      value: "40",
      unit: "percent",
      subject_ids: ["subject_1"],
      report_ids: ["report_1"],
      query_ids: [],
    },
  ],
  materials: [
    {
      id: "material_1",
      name: "Lettuce mix",
      purpose: "CSA box",
      status: "to_check",
      subject_ids: [],
      report_ids: [],
      query_ids: ["query_1"],
    },
  ],
};

describe("FarmRecordPanel", () => {
  it("can render an overview pane with subjects and reports", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showOrdersSection={false}
      />,
    );

    expect(markup).toContain("Subjects");
    expect(markup).toContain("Reports");
    expect(markup).toContain("Queries");
    expect(markup).toContain("Quantity");
    expect(markup).toContain("Measurements");
    expect(markup).toContain("40 heads");
    expect(markup).toContain("Upper block");
    expect(markup).toContain("Tree nuts");
    expect(markup).toContain("Blight pressure");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("CSA box");
  });

  it("can render a measurements-and-materials pane without the profile or report sections", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showAreasSection={false}
        showCropsSection={false}
        showDescriptionSection={false}
        showWorkItemsSection={false}
      />,
    );

    expect(markup).toContain("Measurements &amp; Materials");
    expect(markup).toContain("Lettuce mix");
    expect(markup).not.toContain("Chestnuts");
    expect(markup).not.toContain("Upper block");
    expect(markup).not.toContain("Blight pressure");
    expect(markup).not.toContain("Quantity");
    expect(markup).not.toContain(">Description<");
  });
});
