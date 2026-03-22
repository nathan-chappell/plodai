import { removeStoredValue, readStoredValue, writeStoredValue } from "./kv-store";
import type { WorkspaceContextRecord } from "../types/shell";

const ACTIVE_CONTEXT_PREFIX = "workspace-v1:active-context:";
const WORKSPACE_CONTEXTS_PREFIX = "workspace-v1:contexts:";

export const DEFAULT_WORKSPACE_CONTEXT_ID = "workspace-default";
export const DEFAULT_WORKSPACE_CONTEXT_NAME = "Workspace";

function activeContextKey(userId: string): string {
  return `${ACTIVE_CONTEXT_PREFIX}${userId}`;
}

function workspaceContextsKey(userId: string): string {
  return `${WORKSPACE_CONTEXTS_PREFIX}${userId}`;
}

export function loadWorkspaceContexts(
  userId: string,
): Promise<WorkspaceContextRecord[] | null> {
  return readStoredValue<WorkspaceContextRecord[]>(workspaceContextsKey(userId));
}

export function saveWorkspaceContexts(
  userId: string,
  contexts: WorkspaceContextRecord[],
): Promise<void> {
  return writeStoredValue(workspaceContextsKey(userId), contexts);
}

export function loadActiveWorkspaceContextId(
  userId: string,
): Promise<string | null> {
  return readStoredValue<string>(activeContextKey(userId));
}

export function saveActiveWorkspaceContextId(
  userId: string,
  contextId: string,
): Promise<void> {
  return writeStoredValue(activeContextKey(userId), contextId);
}

export async function clearWorkspaceStorage(userId: string): Promise<void> {
  await Promise.all([
    removeStoredValue(workspaceContextsKey(userId)),
    removeStoredValue(activeContextKey(userId)),
  ]).catch(() => undefined);
}
