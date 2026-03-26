import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FarmRecordPanel } from "../FarmRecordPanel";
import type { FarmRecordPayload } from "../../types/farm";

const SAMPLE_FARM: FarmRecordPayload = {
  version: "v1",
  farm_name: "North Field",
  description: "Mixed vegetables for the spring CSA.",
  location: "River Road",
  crops: [
    {
      id: "crop_1",
      name: "Chestnuts",
      type: "tree_nuts",
      quantity: "2 beds",
      expected_yield: "40 heads",
      issues: [],
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

    expect(markup).toContain("Description");
    expect(markup).toContain("Crops");
    expect(markup).toContain("Quantity");
    expect(markup).toContain("Tree nuts");
    expect(markup).not.toContain("CSA box");
  });

  it("can render an orders-only pane without the description or crop sections", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showCropsSection={false}
        showDescriptionSection={false}
      />,
    );

    expect(markup).toContain(">Orders<");
    expect(markup).not.toContain("Chestnuts");
    expect(markup).not.toContain("Quantity");
    expect(markup).not.toContain(">Description<");
  });
});
