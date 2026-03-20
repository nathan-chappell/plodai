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

export type ToolProviderWorkspaceSnapshot = {
  files?: LocalWorkspaceFile[];
  status: string;
  investigationBrief: string;
  activeWorkspaceTab: string;
  reportEffects: ClientEffect[];
};

const REPORT_FOUNDRY_PREFIX = "workspace:report-foundry:";
const TOOL_PROVIDER_PREFIX = "workspace:tool-provider:";
const LEGACY_CAPABILITY_PREFIX = "workspace:capability:";

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

function toolProviderWorkspaceKey(userId: string, toolProviderId: string): string {
  return `${TOOL_PROVIDER_PREFIX}${toolProviderId}:${userId}`;
}

function legacyCapabilityWorkspaceKey(userId: string, toolProviderId: string): string {
  return `${LEGACY_CAPABILITY_PREFIX}${toolProviderId}:${userId}`;
}

export async function loadToolProviderWorkspace(
  userId: string,
  toolProviderId: string,
): Promise<ToolProviderWorkspaceSnapshot | null> {
  const nextSnapshot = await readStoredValue<ToolProviderWorkspaceSnapshot>(
    toolProviderWorkspaceKey(userId, toolProviderId),
  );
  if (nextSnapshot) {
    await removeStoredValue(legacyCapabilityWorkspaceKey(userId, toolProviderId));
    return nextSnapshot;
  }
  await removeStoredValue(legacyCapabilityWorkspaceKey(userId, toolProviderId));
  return null;
}

export function saveToolProviderWorkspace(
  userId: string,
  toolProviderId: string,
  snapshot: ToolProviderWorkspaceSnapshot,
): Promise<void> {
  return writeStoredValue(toolProviderWorkspaceKey(userId, toolProviderId), snapshot);
}

export async function clearToolProviderWorkspace(userId: string, toolProviderId: string): Promise<void> {
  await removeStoredValue(toolProviderWorkspaceKey(userId, toolProviderId));
  await removeStoredValue(legacyCapabilityWorkspaceKey(userId, toolProviderId));
}

export type CapabilityWorkspaceSnapshot = ToolProviderWorkspaceSnapshot;
export const loadCapabilityWorkspace = loadToolProviderWorkspace;
export const saveCapabilityWorkspace = saveToolProviderWorkspace;
export const clearCapabilityWorkspace = clearToolProviderWorkspace;
