import type { Entity, Widgets } from "@openai/chatkit";

import {
  formatFarmCropStatus,
  formatFarmCropType,
  formatFarmWorkItemKind,
  formatFarmWorkItemStatus,
} from "./farm";
import type { PlodaiComposerEntity, PlodaiEntityType } from "../types/chat-entities";

function getEntityType(entity: Entity): PlodaiEntityType | null {
  const entityType = entity.data?.entity_type;
  return entityType === "farm_image" ||
    entityType === "farm_crop" ||
    entityType === "farm_work_item" ||
    entityType === "farm_order"
    ? entityType
    : null;
}

export function isPlodaiComposerEntity(entity: Entity): entity is PlodaiComposerEntity {
  return getEntityType(entity) !== null;
}

export function buildPlodaiEntityPreview(
  entity: Entity,
): { preview: Widgets.BasicRoot | null } {
  if (!isPlodaiComposerEntity(entity)) {
    return { preview: null };
  }

  const entityType = getEntityType(entity);
  if (!entityType) {
    return { preview: null };
  }

  if (entityType === "farm_image") {
    const previewUrl = entity.data.preview_url;
    if (!previewUrl) {
      return { preview: null };
    }
    const sizeLabel = [entity.data.width, entity.data.height]
      .filter((value) => value && value.trim().length > 0)
      .join(" x ");
    return {
      preview: {
        type: "Basic",
        direction: "col",
        gap: "sm",
        children: [
          {
            type: "Card",
            padding: "md",
            children: [
              {
                type: "Image",
                src: previewUrl,
                alt: entity.title,
                fit: "contain",
                frame: true,
              },
              {
                type: "Title",
                value: entity.title,
              },
              {
                type: "Caption",
                value: sizeLabel || "Farm image",
              },
            ],
          },
        ],
      },
    };
  }

  const badgeLabel =
    entityType === "farm_crop"
      ? "Farm crop"
      : entityType === "farm_work_item"
        ? "Work item"
        : "Farm order";
  const summary = entityType === "farm_crop"
    ? [
        formatFarmCropType(entity.data.type),
        formatFarmCropStatus(entity.data.status),
        entity.data.area_names && `Areas: ${entity.data.area_names}`,
        entity.data.quantity && `Quantity: ${entity.data.quantity}`,
        entity.data.expected_yield && `Expected yield: ${entity.data.expected_yield}`,
        entity.data.work_item_count &&
          `${entity.data.work_item_count} work item${entity.data.work_item_count === "1" ? "" : "s"}`,
        entity.data.highest_severity && `${entity.data.highest_severity} severity`,
      ]
        .filter(Boolean)
        .join(" | ")
    : entityType === "farm_work_item"
      ? [
          formatFarmWorkItemKind(entity.data.kind),
          formatFarmWorkItemStatus(entity.data.status),
          entity.data.severity && `${entity.data.severity} severity`,
          entity.data.related_crop_names && `Crops: ${entity.data.related_crop_names}`,
          entity.data.related_area_names && `Areas: ${entity.data.related_area_names}`,
        ]
          .filter(Boolean)
          .join(" | ")
      : [entity.data.status, entity.data.price_label].filter(Boolean).join(" | ");
  const notes = entityType === "farm_order"
    ? entity.data.summary || entity.data.notes || ""
    : entityType === "farm_work_item"
      ? entity.data.description || entity.data.recommended_follow_up || ""
      : entity.data.next_due_at
        ? `Next due: ${entity.data.next_due_at}`
        : entity.data.notes || "";

  return {
    preview: {
      type: "Basic",
      direction: "col",
      gap: "sm",
      children: [
        {
          type: "Card",
          padding: "md",
          children: [
            {
              type: "Badge",
              label: badgeLabel,
              color: "success",
              variant: "soft",
            },
            {
              type: "Title",
              value: entity.title,
            },
            ...(summary
              ? [
                  {
                    type: "Caption" as const,
                    value: summary,
                  },
                ]
              : []),
            ...(notes
              ? [
                  {
                    type: "Text" as const,
                    value: notes,
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
}
