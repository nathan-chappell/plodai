import type { Entity, Widgets } from "@openai/chatkit";

import { humanizeToken } from "./advisory";
import type { PlodaiComposerEntity, PlodaiEntityType } from "../types/chat-entities";

function getEntityType(entity: Entity): PlodaiEntityType | null {
  const entityType = entity.data?.entity_type;
  return entityType === "advisory_image" ||
    entityType === "advisory_subject" ||
    entityType === "advisory_report" ||
    entityType === "advisory_query" ||
    entityType === "advisory_measurement" ||
    entityType === "advisory_material"
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

  if (entityType === "advisory_image") {
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
                value: sizeLabel || "Evidence image",
              },
            ],
          },
        ],
      },
    };
  }

  const badgeLabel = humanizeToken(entityType.replace("advisory_", "")) ?? "Advisory item";
  const summary = [
    humanizeToken(entity.data.kind),
    humanizeToken(entity.data.category),
    humanizeToken(entity.data.status),
    entity.data.severity && `${entity.data.severity} severity`,
    entity.data.location && `Location: ${entity.data.location}`,
    entity.data.subject_names && `Subjects: ${entity.data.subject_names}`,
    entity.data.value && `Value: ${[entity.data.value, entity.data.unit].filter(Boolean).join(" ")}`,
    entity.data.supplier_name && `Supplier: ${entity.data.supplier_name}`,
  ]
    .filter(Boolean)
    .join(" | ");
  const notes =
    entity.data.description ||
    entity.data.answer_summary ||
    entity.data.recommended_follow_up ||
    entity.data.notes ||
    entity.data.purpose ||
    "";

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
