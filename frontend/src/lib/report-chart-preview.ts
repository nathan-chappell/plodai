import { parseSavedChartArtifact } from "./chart-artifacts";
import { buildImageDataUrlFromBase64 } from "./image";
import type { LocalImageFile, LocalWorkspaceFile } from "../types/report";
import type { ReportChartPanelV1, ReportImagePanelV1 } from "../types/workspace-contract";

function findFileById(
  files: LocalWorkspaceFile[],
  fileId: string | null | undefined,
): LocalWorkspaceFile | null {
  if (!fileId) {
    return null;
  }
  return files.find((file) => file.id === fileId) ?? null;
}

function resolveArtifactSourceFileId(file: LocalWorkspaceFile | null): string | null {
  return file ? parseSavedChartArtifact(file)?.datasetId ?? null : null;
}

export function resolveReportChartArtifactFile(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
): LocalWorkspaceFile | null {
  const directMatch = findFileById(files, panel.dataset_id);
  if (directMatch && parseSavedChartArtifact(directMatch)) {
    return directMatch;
  }

  return (
    files.find((candidate) => {
      const parsed = parseSavedChartArtifact(candidate);
      return parsed?.chartPlanId === panel.chart_plan_id;
    }) ?? null
  );
}

export function resolveReportChartSourceFile(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
): LocalWorkspaceFile | null {
  const directMatch = findFileById(files, panel.dataset_id);
  if (directMatch && (directMatch.kind === "csv" || directMatch.kind === "json")) {
    return directMatch;
  }

  const sourceFromDirectArtifact = findFileById(
    files,
    resolveArtifactSourceFileId(directMatch),
  );
  if (sourceFromDirectArtifact) {
    return sourceFromDirectArtifact;
  }

  const artifactMatch = resolveReportChartArtifactFile(files, panel);
  const sourceFromArtifact = findFileById(
    files,
    resolveArtifactSourceFileId(artifactMatch),
  );
  if (sourceFromArtifact) {
    return sourceFromArtifact;
  }

  return directMatch;
}

export function resolveReportChartRows(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
) {
  const sourceFile = resolveReportChartSourceFile(files, panel);
  return sourceFile && (sourceFile.kind === "csv" || sourceFile.kind === "json")
    ? sourceFile.rows
    : [];
}

export function resolveReportChartImageDataUrl(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
): string | null {
  if (typeof panel.image_data_url === "string" && panel.image_data_url) {
    return panel.image_data_url;
  }

  const artifactFile = resolveReportChartArtifactFile(files, panel);
  return artifactFile ? parseSavedChartArtifact(artifactFile)?.imageDataUrl ?? null : null;
}

export function resolveReportChartSourceLabel(
  files: LocalWorkspaceFile[],
  panel: ReportChartPanelV1,
): string {
  return (
    resolveReportChartSourceFile(files, panel)?.name ??
    resolveReportChartArtifactFile(files, panel)?.name ??
    panel.dataset_id ??
    "unknown"
  );
}

export function resolveReportImageFile(
  files: LocalWorkspaceFile[],
  panel: ReportImagePanelV1,
): LocalImageFile | null {
  const file = findFileById(files, panel.file_id);
  return file?.kind === "image" ? file : null;
}

export function resolveReportImageDataUrl(
  files: LocalWorkspaceFile[],
  panel: ReportImagePanelV1,
): string | null {
  if (typeof panel.image_data_url === "string" && panel.image_data_url) {
    return panel.image_data_url;
  }
  const file = resolveReportImageFile(files, panel);
  return file ? buildImageDataUrlFromBase64(file.bytes_base64, file.mime_type) : null;
}

export function resolveReportImageSourceLabel(
  files: LocalWorkspaceFile[],
  panel: ReportImagePanelV1,
): string {
  return resolveReportImageFile(files, panel)?.name ?? panel.file_id ?? "unknown";
}
