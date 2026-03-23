import type { LocalAttachment } from "../types/report";

export type SavedChartArtifact = {
  title: string;
  chartPlanId: string | null;
  datasetId: string | null;
  imageDataUrl: string | null;
};

function stripExtension(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, dotIndex);
}

function slugifyFilenameSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function trimFilenameBase(value: string, maxLength = 72): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength).replace(/_+$/g, "");
}

export function parseSavedChartArtifact(
  file: LocalAttachment,
): SavedChartArtifact | null {
  if (file.kind !== "other" || !file.text_content) {
    return null;
  }
  try {
    const parsed = JSON.parse(file.text_content) as {
      title?: unknown;
      chart_plan_id?: unknown;
      dataset_id?: unknown;
      image_data_url?: unknown;
      chart?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || !("chart" in parsed)) {
      return null;
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : file.name,
      chartPlanId:
        typeof parsed.chart_plan_id === "string" ? parsed.chart_plan_id : null,
      datasetId:
        typeof parsed.dataset_id === "string" ? parsed.dataset_id : null,
      imageDataUrl:
        typeof parsed.image_data_url === "string"
          ? parsed.image_data_url
          : null,
    };
  } catch {
    return null;
  }
}

export function savedChartArtifactLabel(file: LocalAttachment): string | null {
  return parseSavedChartArtifact(file)?.title ?? null;
}

export function buildChartArtifactFilename({
  title,
  sourceFileName,
}: {
  title?: string | null;
  sourceFileName?: string | null;
}): string {
  const titleSegment = slugifyFilenameSegment(title ?? "");
  const sourceSegment = slugifyFilenameSegment(stripExtension(sourceFileName ?? ""));

  let base =
    titleSegment && titleSegment !== "chart"
      ? titleSegment
      : sourceSegment || titleSegment || "chart";

  if (!base.endsWith("chart")) {
    base = `${base}_chart`;
  }

  const trimmedBase = trimFilenameBase(base) || "chart";
  return `${trimmedBase}.json`;
}
