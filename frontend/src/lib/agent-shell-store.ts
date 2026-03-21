import { removeStoredValue, readStoredValue, writeStoredValue } from "./kv-store";
import type { AgentShellState } from "../types/shell";

const SELECTED_AGENT_PREFIX = "shell:selected-agent:";
const AGENT_STATE_PREFIX = "shell:agent-state:";
const LEGACY_REPORT_FOUNDRY_PREFIX = "workspace:report-foundry:";
const LEGACY_AGENT_PREFIX = "workspace:agent:";
const LEGACY_WORKSPACE_DATABASE = "ai-portfolio-workspace";

function selectedAgentKey(userId: string): string {
  return `${SELECTED_AGENT_PREFIX}${userId}`;
}

function agentStateKey(userId: string, agentId: string): string {
  return `${AGENT_STATE_PREFIX}${agentId}:${userId}`;
}

export function loadSelectedAgentId(userId: string): Promise<string | null> {
  return readStoredValue<string>(selectedAgentKey(userId));
}

export function saveSelectedAgentId(userId: string, agentId: string): Promise<void> {
  return writeStoredValue(selectedAgentKey(userId), agentId);
}

export function loadAgentShellState(
  userId: string,
  agentId: string,
): Promise<AgentShellState | null> {
  return readStoredValue<AgentShellState>(agentStateKey(userId, agentId));
}

export function saveAgentShellState(
  userId: string,
  agentId: string,
  state: AgentShellState,
): Promise<void> {
  return writeStoredValue(agentStateKey(userId, agentId), state);
}

export function clearAgentShellState(
  userId: string,
  agentId: string,
): Promise<void> {
  return removeStoredValue(agentStateKey(userId, agentId));
}

export async function clearLegacyWorkspaceState(
  userId: string,
  agentIds: string[],
): Promise<void> {
  await Promise.all([
    removeStoredValue(`${LEGACY_REPORT_FOUNDRY_PREFIX}${userId}`),
    ...agentIds.map((agentId) =>
      removeStoredValue(`${LEGACY_AGENT_PREFIX}${agentId}:${userId}`),
    ),
  ]).catch(() => undefined);

  await deleteIndexedDbDatabase(LEGACY_WORKSPACE_DATABASE).catch(() => undefined);
}

function deleteIndexedDbDatabase(name: string): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to delete IndexedDB database ${name}.`));
  });
}
