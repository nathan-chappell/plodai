import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./kv-store";

export type ReportFoundryWorkspaceSnapshot = {
  datasets: LocalDataset[];
  status: string;
  investigationBrief: string;
  activeWorkspaceTab: "report" | "datasets" | "goal" | "smoke";
  reportEffects: ClientEffect[];
};

const REPORT_FOUNDRY_PREFIX = "workspace:report-foundry:";

function reportFoundryKey(userId: string): string {
  return `${REPORT_FOUNDRY_PREFIX}${userId}`;
}

export function loadReportFoundryWorkspace(userId: string): Promise<ReportFoundryWorkspaceSnapshot | null> {
  return readStoredValue<ReportFoundryWorkspaceSnapshot>(reportFoundryKey(userId));
}

export function saveReportFoundryWorkspace(
  userId: string,
  snapshot: ReportFoundryWorkspaceSnapshot,
): Promise<void> {
  return writeStoredValue(reportFoundryKey(userId), snapshot);
}

export function clearReportFoundryWorkspace(userId: string): Promise<void> {
  return removeStoredValue(reportFoundryKey(userId));
}
