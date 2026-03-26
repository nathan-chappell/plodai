import type {
  FarmCropIssueSeverity,
  FarmCrop,
  FarmRecordPayload,
} from "../types/farm";

export const UNNAMED_FARM_LABEL = "Unnamed Farm";

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function getFarmDisplayName(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? UNNAMED_FARM_LABEL;
}

export function formatFarmCropType(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const humanized = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

export function normalizeFarmCrop(crop: FarmCrop): FarmCrop {
  return {
    ...crop,
    type: formatFarmCropType(crop.type),
    quantity: normalizeOptionalText(crop.quantity),
    expected_yield: normalizeOptionalText(crop.expected_yield),
    issues: crop.issues.map((issue) => ({
      ...issue,
      description: normalizeOptionalText(issue.description),
      deadline: normalizeOptionalText(issue.deadline),
      recommended_follow_up: normalizeOptionalText(issue.recommended_follow_up),
    })),
  };
}

export function normalizeFarmPayload(farm: FarmRecordPayload): FarmRecordPayload {
  return {
    ...farm,
    description: normalizeOptionalText(farm.description),
    location: normalizeOptionalText(farm.location),
    crops: farm.crops.map(normalizeFarmCrop),
    orders: farm.orders ?? [],
  };
}

function severityRank(severity: FarmCropIssueSeverity): number {
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

export function summarizeFarmCropIssues(crop: FarmCrop): {
  issueCount: number;
  highestSeverity: FarmCropIssueSeverity | null;
  nextDeadline: string | null;
} {
  const normalizedCrop = normalizeFarmCrop(crop);
  let highestSeverity: FarmCropIssueSeverity | null = null;
  const deadlines = normalizedCrop.issues
    .map((issue) => normalizeOptionalText(issue.deadline))
    .filter((deadline): deadline is string => deadline !== null)
    .sort((left, right) => {
      const leftKey = deadlineSortKey(left);
      const rightKey = deadlineSortKey(right);
      if (leftKey[0] !== rightKey[0]) {
        return leftKey[0] - rightKey[0];
      }
      return leftKey[1].localeCompare(rightKey[1]);
    });

  for (const issue of normalizedCrop.issues) {
    if (!highestSeverity || severityRank(issue.severity) > severityRank(highestSeverity)) {
      highestSeverity = issue.severity;
    }
  }

  return {
    issueCount: normalizedCrop.issues.length,
    highestSeverity,
    nextDeadline: deadlines[0] ?? null,
  };
}
