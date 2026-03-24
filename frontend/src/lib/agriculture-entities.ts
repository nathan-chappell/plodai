import type { Entity, Widgets } from "@openai/chatkit";

import type { AgricultureComposerEntity, AgricultureEntityType } from "../types/chat-entities";

function getEntityType(entity: Entity): AgricultureEntityType | null {
  const entityType = entity.data?.entity_type;
  return entityType === "thread_image" ||
    entityType === "farm_crop" ||
    entityType === "farm_issue" ||
    entityType === "farm_project" ||
    entityType === "farm_current_work" ||
    entityType === "farm_order"
    ? entityType
    : null;
}

export function isAgricultureComposerEntity(entity: Entity): entity is AgricultureComposerEntity {
  return getEntityType(entity) !== null;
}

export function buildAgricultureEntityPreview(
  entity: Entity,
): { preview: Widgets.BasicRoot | null } {
  if (!isAgricultureComposerEntity(entity)) {
    return { preview: null };
  }

  const entityType = getEntityType(entity);
  if (!entityType) {
    return { preview: null };
  }

  if (entityType === "thread_image") {
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
                value: sizeLabel || "Thread image",
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
      : entityType === "farm_issue"
        ? "Farm issue"
        : entityType === "farm_project"
          ? "Farm project"
          : entityType === "farm_order"
            ? "Farm order"
            : "Current work";
  const summary =
    entityType === "farm_crop"
      ? [entity.data.area, entity.data.expected_yield && `Expected yield: ${entity.data.expected_yield}`]
          .filter(Boolean)
          .join(" | ")
      : entityType === "farm_issue" || entityType === "farm_project"
        ? entity.data.status || entity.data.farm_name || ""
        : entityType === "farm_order"
          ? [entity.data.status, entity.data.price_label].filter(Boolean).join(" | ")
        : entity.data.farm_name || "";
  const notes = entityType === "farm_order" ? entity.data.summary || entity.data.notes || "" : entity.data.notes || "";

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
