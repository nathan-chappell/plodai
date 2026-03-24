// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlodaiFarmPane } from "../PlodaiFarmPane";
import type {
  WorkspaceCreatedItemDetail,
  WorkspaceCreatedItemSummary,
  WorkspaceListItem,
} from "../../types/workspace";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function buildFarmArtifact(): {
  detail: WorkspaceCreatedItemDetail;
  summary: WorkspaceCreatedItemSummary;
} {
  const summary: WorkspaceCreatedItemSummary = {
    origin: "created",
    id: "farm-1",
    workspace_id: "workspace-1",
    kind: "farm.v1",
    schema_version: "v1",
    title: "North Orchard",
    current_revision: 3,
    created_by_user_id: "user_123",
    created_by_agent_id: "plodai-agent",
    last_edited_by_agent_id: "plodai-agent",
    summary: {
      crop_count: 2,
      order_count: 1,
    },
    latest_op: "farm.set_state",
    created_at: "2026-03-23T09:00:00.000Z",
    updated_at: "2026-03-23T10:00:00.000Z",
  };

  return {
    summary,
    detail: {
      ...summary,
      payload: {
        version: "v1",
        farm_name: "North Orchard",
        location: "Block A",
        crops: [
          {
            id: "crop_1",
            name: "Honeycrisp apples",
            area: "12 acres",
            expected_yield: "480 bins",
            notes: "Watch the lower canopy.",
          },
          {
            id: "crop_2",
            name: "Cherries",
            area: "4 acres",
            expected_yield: "120 crates",
            notes: null,
          },
        ],
        orders: [
          {
            id: "order_1",
            title: "Sataras mix",
            status: "draft",
            summary: "A ready-to-cook farm mix.",
            price_label: "9 EUR",
            order_url: "https://farm.example/orders/sataras-mix",
            notes: "Pickup on Fridays.",
            items: [
              {
                id: "item_1",
                label: "Peppers",
                quantity: "2 kg",
                crop_id: "crop_1",
                notes: null,
              },
            ],
            hero_image_file_id: null,
            hero_image_alt_text: null,
          },
        ],
        notes: "Keep an eye on the lower canopy.",
      },
    },
  };
}

const workspaces: WorkspaceListItem[] = [
  {
    id: "workspace-1",
    app_id: "plodai",
    name: "North Orchard",
    active_chat_id: null,
    selected_item_id: "farm-1",
    current_report_item_id: null,
    item_count: 1,
    created_at: "2026-03-23T09:00:00.000Z",
    updated_at: "2026-03-23T10:00:00.000Z",
  },
];

describe("PlodaiFarmPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderPane({
    activeSectionId = "farm",
    applyArtifactOperation = vi.fn(),
  }: {
    activeSectionId?: "farm" | "orders";
    applyArtifactOperation?: ReturnType<typeof vi.fn>;
  } = {}) {
    const artifact = buildFarmArtifact();

    await act(async () => {
      root.render(
        <PlodaiFarmPane
          activeWorkspaceId="workspace-1"
          activeSectionId={activeSectionId}
          applyArtifactOperation={applyArtifactOperation}
          deleteArtifact={vi.fn()}
          farmArtifactSummary={artifact.summary}
          focusTarget={null}
          getArtifact={async () => artifact.detail}
          onCreateWorkspace={() => {}}
          onSelectWorkspace={() => {}}
          selectedArtifactId={artifact.summary.id}
          workspaces={workspaces}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    return artifact;
  }

  it("asks for confirmation before deleting a crop row", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const applyArtifactOperation = vi.fn();

    await renderPane({ applyArtifactOperation });

    const deleteButton = container.querySelector(
      "[data-testid='farm-delete-crop-crop_1']",
    ) as HTMLButtonElement | null;

    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Delete Honeycrisp apples from North Orchard?");
    expect(applyArtifactOperation).not.toHaveBeenCalled();
  });

  it("persists a crop deletion after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const artifact = buildFarmArtifact();
    const applyArtifactOperation = vi.fn().mockResolvedValue({
      ...artifact.detail,
      current_revision: artifact.detail.current_revision + 1,
      payload: {
        ...artifact.detail.payload,
        crops: artifact.detail.payload.crops.filter((crop) => crop.id !== "crop_1"),
      },
    });

    await renderPane({ applyArtifactOperation });

    const deleteButton = container.querySelector(
      "[data-testid='farm-delete-crop-crop_1']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Delete Honeycrisp apples from North Orchard?");
    expect(applyArtifactOperation).toHaveBeenCalledTimes(1);
    expect(applyArtifactOperation).toHaveBeenCalledWith("farm-1", {
      base_revision: 3,
      operation: {
        op: "farm.set_state",
        farm_name: "North Orchard",
        location: "Block A",
        crops: [
          {
            id: "crop_2",
            name: "Cherries",
            area: "4 acres",
            expected_yield: "120 crates",
            notes: null,
          },
        ],
        orders: [
          {
            id: "order_1",
            title: "Sataras mix",
            status: "draft",
            summary: "A ready-to-cook farm mix.",
            price_label: "9 EUR",
            order_url: "https://farm.example/orders/sataras-mix",
            notes: "Pickup on Fridays.",
            items: [
              {
                id: "item_1",
                label: "Peppers",
                quantity: "2 kg",
                crop_id: "crop_1",
                notes: null,
              },
            ],
            hero_image_file_id: null,
            hero_image_alt_text: null,
          },
        ],
        notes: "Keep an eye on the lower canopy.",
      },
    });
  });

  it("asks for confirmation before removing an order", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const applyArtifactOperation = vi.fn();

    await renderPane({
      activeSectionId: "orders",
      applyArtifactOperation,
    });

    const deleteButton = container.querySelector(
      "[data-testid='farm-delete-order-order_1']",
    ) as HTMLButtonElement | null;

    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Remove Sataras mix from North Orchard?");
    expect(applyArtifactOperation).not.toHaveBeenCalled();
  });
});
