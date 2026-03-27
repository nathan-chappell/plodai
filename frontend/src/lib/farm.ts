import type {
  FarmArea,
  FarmCrop,
  FarmRecordPayload,
  FarmWorkItem,
  FarmWorkItemSeverity,
} from "../types/farm";

export const UNNAMED_FARM_LABEL = "Unnamed Farm";

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function humanizeToken(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const humanized = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

export function getFarmDisplayName(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? UNNAMED_FARM_LABEL;
}

export function formatFarmCropType(value: string | null | undefined): string | null {
  return humanizeToken(value);
}

export function formatFarmCropStatus(value: string | null | undefined): string | null {
  return humanizeToken(value);
}

export function formatFarmWorkItemKind(value: string | null | undefined): string | null {
  return humanizeToken(value);
}

export function formatFarmWorkItemStatus(value: string | null | undefined): string | null {
  return humanizeToken(value);
}

function normalizeFarmArea(area: FarmArea): FarmArea {
  return {
    ...area,
    kind: humanizeToken(area.kind),
    description: normalizeOptionalText(area.description),
  };
}

export function normalizeFarmCrop(crop: FarmCrop): FarmCrop {
  return {
    ...crop,
    type: formatFarmCropType(crop.type),
    quantity: normalizeOptionalText(crop.quantity),
    expected_yield: normalizeOptionalText(crop.expected_yield),
    area_ids: crop.area_ids ?? [],
    status: crop.status ?? null,
    notes: normalizeOptionalText(crop.notes),
  };
}

function normalizeFarmWorkItem(workItem: FarmWorkItem): FarmWorkItem {
  return {
    ...workItem,
    status: workItem.status ?? null,
    severity: workItem.severity ?? null,
    description: normalizeOptionalText(workItem.description),
    observed_at: normalizeOptionalText(workItem.observed_at),
    due_at: normalizeOptionalText(workItem.due_at),
    recommended_follow_up: normalizeOptionalText(workItem.recommended_follow_up),
    related_crop_ids: workItem.related_crop_ids ?? [],
    related_area_ids: workItem.related_area_ids ?? [],
    related_image_ids: workItem.related_image_ids ?? [],
  };
}

export function normalizeFarmPayload(farm: FarmRecordPayload): FarmRecordPayload {
  return {
    ...farm,
    description: normalizeOptionalText(farm.description),
    location: normalizeOptionalText(farm.location),
    areas: (farm.areas ?? []).map(normalizeFarmArea),
    crops: farm.crops.map(normalizeFarmCrop),
    work_items: (farm.work_items ?? []).map(normalizeFarmWorkItem),
    orders: farm.orders ?? [],
  };
}

function severityRank(severity: FarmWorkItemSeverity): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function deadlineSortKey(deadline: string): [number, string] {
  const timestamp = Date.parse(deadline);
  return Number.isNaN(timestamp) ? [1, deadline.toLowerCase()] : [0, `${timestamp}`];
}

export function getAreaNamesForIds(
  farm: FarmRecordPayload,
  areaIds: readonly string[],
): string[] {
  const areasById = new Map(
    normalizeFarmPayload(farm).areas.map((area) => [area.id, area] as const),
  );
  return areaIds
    .map((areaId) => areasById.get(areaId)?.name?.trim() ?? "")
    .filter((name) => name.length > 0);
}

export function getWorkItemsForCrop(
  farm: FarmRecordPayload,
  cropId: string,
): FarmWorkItem[] {
  const normalizedFarm = normalizeFarmPayload(farm);
  return normalizedFarm.work_items.filter((workItem) =>
    workItem.related_crop_ids.includes(cropId),
  );
}

export function summarizeFarmCropWorkItems(
  farm: FarmRecordPayload,
  cropId: string,
): {
  workItemCount: number;
  highestSeverity: FarmWorkItemSeverity | null;
  nextDueAt: string | null;
  titles: string[];
} {
  const linkedWorkItems = getWorkItemsForCrop(farm, cropId);
  let highestSeverity: FarmWorkItemSeverity | null = null;
  const dueDates = linkedWorkItems
    .map((workItem) => normalizeOptionalText(workItem.due_at))
    .filter((dueAt): dueAt is string => dueAt !== null)
    .sort((left, right) => {
      const leftKey = deadlineSortKey(left);
      const rightKey = deadlineSortKey(right);
      if (leftKey[0] !== rightKey[0]) {
        return leftKey[0] - rightKey[0];
      }
      return leftKey[1].localeCompare(rightKey[1]);
    });

  for (const workItem of linkedWorkItems) {
    if (!workItem.severity) {
      continue;
    }
    if (!highestSeverity || severityRank(workItem.severity) > severityRank(highestSeverity)) {
      highestSeverity = workItem.severity;
    }
  }

  return {
    workItemCount: linkedWorkItems.length,
    highestSeverity,
    nextDueAt: dueDates[0] ?? null,
    titles: linkedWorkItems.map((workItem) => workItem.title),
  };
}
