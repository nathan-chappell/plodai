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
      name: "Spring lettuce",
      type: "leafy greens",
      size: "2 beds",
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
  it("can render an overview-only pane", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showCropsSection={false}
        showOrdersSection={false}
      />,
    );

    expect(markup).toContain("Description");
    expect(markup).not.toContain("Crop Blocks");
    expect(markup).not.toContain("CSA box");
  });

  it("can render the inventory and orders pane without the description section", () => {
    const markup = renderToStaticMarkup(
      <FarmRecordPanel
        farm={SAMPLE_FARM}
        showDescriptionSection={false}
      />,
    );

    expect(markup).toContain("Crop Blocks");
    expect(markup).toContain(">Orders<");
    expect(markup).not.toContain(">Description<");
  });
});
