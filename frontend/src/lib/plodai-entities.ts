import type { Entity, Widgets } from "@openai/chatkit";

import { formatFarmCropType } from "./farm";
import type { PlodaiComposerEntity, PlodaiEntityType } from "../types/chat-entities";

function getEntityType(entity: Entity): PlodaiEntityType | null {
  const entityType = entity.data?.entity_type;
  return entityType === "farm_image" ||
    entityType === "farm_crop" ||
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
      : "Farm order";
  const summary =
    entityType === "farm_crop"
      ? [
          formatFarmCropType(entity.data.type),
          entity.data.quantity && `Quantity: ${entity.data.quantity}`,
          entity.data.expected_yield && `Expected yield: ${entity.data.expected_yield}`,
          entity.data.issue_count && `${entity.data.issue_count} issue${entity.data.issue_count === "1" ? "" : "s"}`,
          entity.data.highest_severity && `${entity.data.highest_severity} severity`,
        ]
          .filter(Boolean)
          .join(" | ")
      : [entity.data.status, entity.data.price_label].filter(Boolean).join(" | ");
  const notes = entityType === "farm_order"
    ? entity.data.summary || entity.data.notes || ""
    : entity.data.next_deadline
      ? `Next deadline: ${entity.data.next_deadline}`
      : "";

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
