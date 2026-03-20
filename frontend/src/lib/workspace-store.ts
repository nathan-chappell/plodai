import type { ClientEffect } from "../types/analysis";
import type { LocalDataset, LocalWorkspaceFile } from "../types/report";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./kv-store";

export type ReportFoundryWorkspaceSnapshot = {
  datasets: LocalDataset[];
  status: string;
  investigationBrief: string;
  activeWorkspaceTab: "report" | "datasets" | "goal" | "integration";
  reportEffects: ClientEffect[];
};

export type CapabilityWorkspaceSnapshot = {
  files?: LocalWorkspaceFile[];
  status: string;
  investigationBrief: string;
  activeWorkspaceTab: string;
  reportEffects: ClientEffect[];
};

const REPORT_FOUNDRY_PREFIX = "workspace:report-foundry:";
const CAPABILITY_PREFIX = "workspace:capability:";

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

function capabilityWorkspaceKey(userId: string, capabilityId: string): string {
  return `${CAPABILITY_PREFIX}${capabilityId}:${userId}`;
}

export function loadCapabilityWorkspace(
  userId: string,
  capabilityId: string,
): Promise<CapabilityWorkspaceSnapshot | null> {
  return readStoredValue<CapabilityWorkspaceSnapshot>(capabilityWorkspaceKey(userId, capabilityId));
}

export function saveCapabilityWorkspace(
  userId: string,
  capabilityId: string,
  snapshot: CapabilityWorkspaceSnapshot,
): Promise<void> {
  return writeStoredValue(capabilityWorkspaceKey(userId, capabilityId), snapshot);
}

export function clearCapabilityWorkspace(userId: string, capabilityId: string): Promise<void> {
  return removeStoredValue(capabilityWorkspaceKey(userId, capabilityId));
}
