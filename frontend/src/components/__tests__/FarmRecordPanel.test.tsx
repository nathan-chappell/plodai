import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FarmRecordPanel } from "../FarmRecordPanel";
import type { FarmRecordPayload } from "../../types/farm";

const SAMPLE_FARM: FarmRecordPayload = {
  version: "v1",
  farm_name: "North Field",
  description: "Mixed vegetables for the spring CSA.",
  location: "River Road",
  areas: [
    {
      id: "area_1",
      name: "Upper block",
      kind: "orchard",
      description: "Main production rows.",
    },
  ],
  crops: [
    {
      id: "crop_1",
      name: "Chestnuts",
      type: "tree_nuts",
      quantity: "2 beds",
      expected_yield: "40 heads",
      area_ids: ["area_1"],
      status: "active",
      notes: "Pruned this month.",
    },
  ],
  work_items: [
    {
      id: "work_1",
      kind: "issue",
      title: "Blight pressure",
      description: "Scattered lesions on the outer canopy.",
      status: "monitoring",
      severity: "high",
      due_at: "2026-04-10",
      related_crop_ids: ["crop_1"],
      related_area_ids: ["area_1"],
      related_image_ids: [],
    },
  ],
  orders: [
    {
      id: "order_1",
      title: "CSA box",
      status: "draft",
      items: [
        {
          id: "item_1",
          label: "Lettuce mix",
          quantity: "2 bags",
        },
      ],
    },
  ],
};

describe("FarmRecordPanel", () => {
  it("can render an overview pane with crops and without orders", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showOrdersSection={false}
      />,
    );

    expect(markup).toContain("Areas");
    expect(markup).toContain("Crops");
    expect(markup).toContain("Work Items");
    expect(markup).toContain("Quantity");
    expect(markup).toContain("Expected yield");
    expect(markup).toContain("40 heads");
    expect(markup).toContain("Upper block");
    expect(markup).toContain("Tree nuts");
    expect(markup).toContain("Blight pressure");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("CSA box");
  });

  it("can render an orders-only pane without the description or crop sections", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showAreasSection={false}
        showCropsSection={false}
        showDescriptionSection={false}
        showWorkItemsSection={false}
      />,
    );

    expect(markup).toContain(">Orders<");
    expect(markup).not.toContain("Chestnuts");
    expect(markup).not.toContain("Upper block");
    expect(markup).not.toContain("Blight pressure");
    expect(markup).not.toContain("Quantity");
    expect(markup).not.toContain(">Description<");
  });
});
