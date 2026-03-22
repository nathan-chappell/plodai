import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAppState } from "./context";
import {
  loadActiveWorkspaceContextId,
  loadWorkspaceContexts,
  saveActiveWorkspaceContextId,
  saveWorkspaceContexts,
} from "../lib/agent-shell-store";
import { buildShellStateMetadata } from "../lib/shell-metadata";
import {
  buildAgentPreviewModel,
  buildResourceFromFile,
  createEmptyAgentShellState,
  listFileResources,
  normalizeAgentShellState,
  removeAgentResource,
  replaceAgentResources,
  sortResources,
} from "../lib/shell-resources";
import { buildWorkspaceFile } from "../lib/workspace-files";
import { getAgentDefinition, runtimeAgentDefinitions } from "../agents/definitions";
import type { AgentDefinition } from "../agents/types";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  AgentPreviewModel,
  AgentResourceRecord,
  AgentShellState,
  ShellStateMetadata,
  WorkspaceContextRecord,
} from "../types/shell";

const DEFAULT_AGENT_ID = "default-agent";
const DEFAULT_CONTEXT_NAME = "Workspace";
const PERSISTED_AGENT_IDS = runtimeAgentDefinitions
  .filter((agent) => agent.id !== "feedback-agent")
  .map((agent) => agent.id);

type CreateContextOptions = {
  agentId?: string;
  name?: string;
};

type HandleSelectFilesOptions = {
  contextId?: string;
};

type AgentShellContextValue = {
  currentUserId: string | null;
  hydrated: boolean;
  contexts: WorkspaceContextRecord[];
  activeContextId: string;
  activeContextName: string;
  selectedAgentId: string;
  selectedAgentDefinition: AgentDefinition;
  selectedAgentState: AgentShellState;
  selectedAgentResources: AgentResourceRecord[];
  selectedAgentFiles: LocalWorkspaceFile[];
  selectedAgentPreview: AgentPreviewModel;
  sharedResources: AgentResourceRecord[];
  shellStateMetadata: ShellStateMetadata;
  selectAgent: (agentId: string) => void;
  selectContextAndAgent: (contextId: string, agentId: string) => void;
  createContext: (options?: CreateContextOptions) => string;
  getAgentState: (agentId: string) => AgentShellState;
  updateAgentState: (
    agentId: string,
    updater: (state: AgentShellState) => AgentShellState,
  ) => void;
  replaceAgentResources: (agentId: string, resources: AgentResourceRecord[]) => void;
  removeAgentResource: (agentId: string, resourceId: string) => void;
  clearAgentState: (agentId: string) => void;
  clearSelectedAgentState: () => void;
  handleSelectFiles: (
    agentId: string,
    files: FileList | Iterable<File> | null | undefined,
    options?: HandleSelectFilesOptions,
  ) => Promise<LocalWorkspaceFile[]>;
  resolveResource: (resourceId: string) => AgentResourceRecord | null;
  getPreviewResources: (agentId: string) => AgentResourceRecord[];
};

const AgentShellContext = createContext<AgentShellContextValue | null>(null);

function nowIso(): string {
  return new Date().toISOString();
}

function nextContextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `workspace-${crypto.randomUUID()}`;
  }
  return `workspace-${Math.random().toString(36).slice(2, 12)}`;
}

function buildInitialStates(): Record<string, AgentShellState> {
  return Object.fromEntries(
    PERSISTED_AGENT_IDS.map((agentId) => [agentId, createEmptyAgentShellState()]),
  );
}

function normalizeSelectedAgentId(value: string | null | undefined): string {
  return value && PERSISTED_AGENT_IDS.includes(value) ? value : DEFAULT_AGENT_ID;
}

function normalizeStates(
  statesByAgentId: Record<string, AgentShellState>,
): Record<string, AgentShellState> {
  return Object.fromEntries(
    PERSISTED_AGENT_IDS.map((agentId) => [
      agentId,
      normalizeAgentShellState(statesByAgentId[agentId]),
    ]),
  );
}

function sortContexts(contexts: WorkspaceContextRecord[]): WorkspaceContextRecord[] {
  return [...contexts].sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

function normalizeContextRecord(context: WorkspaceContextRecord): WorkspaceContextRecord {
  const normalizedStates = normalizeStates(context.states_by_agent_id ?? buildInitialStates());
  return {
    ...context,
    name:
      typeof context.name === "string" && context.name.trim()
        ? context.name.trim()
        : DEFAULT_CONTEXT_NAME,
    selected_agent_id: normalizeSelectedAgentId(context.selected_agent_id),
    states_by_agent_id: normalizedStates,
    created_at:
      typeof context.created_at === "string" && context.created_at.trim()
        ? context.created_at
        : nowIso(),
    updated_at:
      typeof context.updated_at === "string" && context.updated_at.trim()
        ? context.updated_at
        : nowIso(),
  };
}

function normalizeContexts(
  contexts: WorkspaceContextRecord[] | null | undefined,
): WorkspaceContextRecord[] {
  if (!contexts?.length) {
    const timestamp = nowIso();
    return [
      {
        id: "workspace-default",
        name: DEFAULT_CONTEXT_NAME,
        selected_agent_id: DEFAULT_AGENT_ID,
        states_by_agent_id: buildInitialStates(),
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
  }
  return sortContexts(contexts.map((context) => normalizeContextRecord(context)));
}

function normalizeActiveContextId(
  contexts: WorkspaceContextRecord[],
  activeContextId: string | null | undefined,
): string {
  return contexts.some((context) => context.id === activeContextId)
    ? (activeContextId as string)
    : contexts[0]?.id ?? "workspace-default";
}

function buildNextContextName(contexts: WorkspaceContextRecord[]): string {
  const usedNames = new Set(contexts.map((context) => context.name.trim().toLowerCase()));
  if (!usedNames.has(DEFAULT_CONTEXT_NAME.toLowerCase())) {
    return DEFAULT_CONTEXT_NAME;
  }
  let suffix = 2;
  while (usedNames.has(`${DEFAULT_CONTEXT_NAME.toLowerCase()} ${suffix}`)) {
    suffix += 1;
  }
  return `${DEFAULT_CONTEXT_NAME} ${suffix}`;
}

function createWorkspaceContext(selectedAgentId: string, name: string): WorkspaceContextRecord {
  const timestamp = nowIso();
  return {
    id: nextContextId(),
    name,
    selected_agent_id: normalizeSelectedAgentId(selectedAgentId),
    states_by_agent_id: buildInitialStates(),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function toFileArray(
  files: FileList | Iterable<File> | null | undefined,
): File[] {
  if (!files) {
    return [];
  }
  if (typeof FileList !== "undefined" && files instanceof FileList) {
    return Array.from(files);
  }
  return Array.from(files);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAppState();
  const currentUserId = user?.id ?? null;
  const [contexts, setContexts] = useState<WorkspaceContextRecord[]>(normalizeContexts(null));
  const [activeContextId, setActiveContextId] = useState<string>("workspace-default");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!currentUserId) {
      const initialContexts = normalizeContexts(null);
      setContexts(initialContexts);
      setActiveContextId(initialContexts[0]?.id ?? "workspace-default");
      setHydrated(false);
      return;
    }

    let cancelled = false;
    setHydrated(false);

    void (async () => {
      const [storedContexts, storedActiveContextId] = await Promise.all([
        loadWorkspaceContexts(currentUserId),
        loadActiveWorkspaceContextId(currentUserId),
      ]);

      const nextContexts = normalizeContexts(storedContexts);
      const nextActiveContextId = normalizeActiveContextId(nextContexts, storedActiveContextId);

      if (cancelled) {
        return;
      }

      setContexts(nextContexts);
      setActiveContextId(nextActiveContextId);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || !hydrated) {
      return;
    }

    const normalizedWorkspaceContexts = normalizeContexts(contexts);
    const resolvedActiveContextId = normalizeActiveContextId(
      normalizedWorkspaceContexts,
      activeContextId,
    );
    const timeoutId = window.setTimeout(() => {
      void Promise.all([
        saveWorkspaceContexts(currentUserId, normalizedWorkspaceContexts),
        saveActiveWorkspaceContextId(currentUserId, resolvedActiveContextId),
      ]).catch(() => undefined);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [activeContextId, contexts, currentUserId, hydrated]);

  const updateContextById = useCallback(
    (contextId: string, updater: (context: WorkspaceContextRecord) => WorkspaceContextRecord) => {
      setContexts((current) =>
        sortContexts(
          current.map((context) =>
            context.id === contextId ? normalizeContextRecord(updater(context)) : context,
          ),
        ),
      );
    },
    [],
  );

  const updateActiveContext = useCallback(
    (updater: (context: WorkspaceContextRecord) => WorkspaceContextRecord) => {
      updateContextById(activeContextId, updater);
    },
    [activeContextId, updateContextById],
  );

  const selectAgent = useCallback(
    (agentId: string) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      updateActiveContext((context) =>
        context.selected_agent_id === resolvedAgentId
          ? context
          : {
              ...context,
              selected_agent_id: resolvedAgentId,
              updated_at: nowIso(),
            },
      );
    },
    [updateActiveContext],
  );

  const selectContextAndAgent = useCallback(
    (contextId: string, agentId: string) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      setContexts((current) =>
        sortContexts(
          current.map((context) =>
            context.id === contextId
              ? normalizeContextRecord({
                  ...context,
                  selected_agent_id: resolvedAgentId,
                  updated_at: nowIso(),
                })
              : context,
          ),
        ),
      );
      setActiveContextId(contextId);
    },
    [],
  );

  const updateAgentState = useCallback(
    (agentId: string, updater: (state: AgentShellState) => AgentShellState) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      updateActiveContext((context) => {
        const currentStates = normalizeStates(context.states_by_agent_id);
        const currentState = normalizeAgentShellState(currentStates[resolvedAgentId]);
        const nextState = normalizeAgentShellState(updater(currentState));
        return {
          ...context,
          states_by_agent_id: {
            ...currentStates,
            [resolvedAgentId]: nextState,
          },
          updated_at: nowIso(),
        };
      });
    },
    [updateActiveContext],
  );

  const replaceResourcesForAgent = useCallback(
    (agentId: string, resources: AgentResourceRecord[]) => {
      updateAgentState(agentId, (state) => replaceAgentResources(state, resources));
    },
    [updateAgentState],
  );

  const removeResourceForAgent = useCallback(
    (agentId: string, resourceId: string) => {
      updateAgentState(agentId, (state) => removeAgentResource(state, resourceId));
    },
    [updateAgentState],
  );

  const clearAgentStateById = useCallback(
    (agentId: string) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      updateActiveContext((context) => ({
        ...context,
        states_by_agent_id: {
          ...normalizeStates(context.states_by_agent_id),
          [resolvedAgentId]: createEmptyAgentShellState(),
        },
        updated_at: nowIso(),
      }));
    },
    [updateActiveContext],
  );

  const handleSelectFiles = useCallback(
    async (
      agentId: string,
      files: FileList | Iterable<File> | null | undefined,
      options?: HandleSelectFilesOptions,
    ) => {
      const nextFiles = toFileArray(files);
      if (!nextFiles.length) {
        return [];
      }
      const targetContextId = options?.contextId ?? activeContextId;
      const ownerAgentId = normalizeSelectedAgentId(agentId);
      const builtFiles = await Promise.all(nextFiles.map((file) => buildWorkspaceFile(file)));
      const builtResources = builtFiles.map((file) =>
        buildResourceFromFile(ownerAgentId, file, {
          origin: "uploaded",
        }),
      );
      updateContextById(targetContextId, (context) => {
        const currentStates = normalizeStates(context.states_by_agent_id);
        const currentState = normalizeAgentShellState(currentStates[ownerAgentId]);
        return {
          ...context,
          states_by_agent_id: {
            ...currentStates,
            [ownerAgentId]: {
              ...currentState,
              resources: sortResources([...currentState.resources, ...builtResources]),
            },
          },
          updated_at: nowIso(),
        };
      });
      return builtFiles;
    },
    [activeContextId, updateContextById],
  );

  const normalizedContexts = useMemo(
    () => normalizeContexts(contexts),
    [contexts],
  );
  const resolvedActiveContextId = normalizeActiveContextId(normalizedContexts, activeContextId);
  const activeContext =
    normalizedContexts.find((context) => context.id === resolvedActiveContextId) ??
    normalizedContexts[0];
  const normalizedStates = useMemo(
    () => normalizeStates(activeContext?.states_by_agent_id ?? buildInitialStates()),
    [activeContext],
  );
  const selectedAgentId = normalizeSelectedAgentId(activeContext?.selected_agent_id);
  const selectedAgentDefinition =
    getAgentDefinition(selectedAgentId) ?? getAgentDefinition(DEFAULT_AGENT_ID)!;

  const createContext = useCallback(
    (options?: CreateContextOptions) => {
      const nextContext = createWorkspaceContext(
        options?.agentId ?? selectedAgentId,
        options?.name?.trim() || buildNextContextName(contexts),
      );
      setContexts((current) => sortContexts([nextContext, ...current]));
      setActiveContextId(nextContext.id);
      return nextContext.id;
    },
    [contexts, selectedAgentId],
  );

  const sharedResources = useMemo(
    () =>
      Object.values(normalizedStates)
        .flatMap((state) => state.resources)
        .sort(
          (left, right) =>
            right.created_at.localeCompare(left.created_at) ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id),
        ),
    [normalizedStates],
  );

  const resolveResource = useCallback(
    (resourceId: string) =>
      sharedResources.find((resource) => resource.id === resourceId) ?? null,
    [sharedResources],
  );

  const getPreviewResources = useCallback(
    (agentId: string) =>
      agentId === DEFAULT_AGENT_ID
        ? sharedResources
        : normalizeAgentShellState(normalizedStates[normalizeSelectedAgentId(agentId)]).resources,
    [normalizedStates, sharedResources],
  );

  const selectedAgentState = normalizeAgentShellState(normalizedStates[selectedAgentId]);
  const selectedAgentResources = getPreviewResources(selectedAgentId);
  const selectedAgentFiles = useMemo(
    () => listFileResources(selectedAgentResources),
    [selectedAgentResources],
  );
  const selectedAgentPreview = useMemo(
    () =>
      buildAgentPreviewModel({
        agentId: selectedAgentId,
        title: selectedAgentDefinition.title,
        resources: selectedAgentResources,
      }),
    [selectedAgentDefinition.title, selectedAgentId, selectedAgentResources],
  );
  const shellStateMetadata = useMemo(
    () =>
      buildShellStateMetadata({
        contextId: activeContext?.id ?? "workspace-default",
        contextName: activeContext?.name ?? DEFAULT_CONTEXT_NAME,
        activeAgentId: selectedAgentId,
        statesByAgentId: normalizedStates,
      }),
    [activeContext?.id, activeContext?.name, normalizedStates, selectedAgentId],
  );

  const value = useMemo<AgentShellContextValue>(
    () => ({
      currentUserId,
      hydrated,
      contexts: normalizedContexts,
      activeContextId: activeContext?.id ?? "workspace-default",
      activeContextName: activeContext?.name ?? DEFAULT_CONTEXT_NAME,
      selectedAgentId,
      selectedAgentDefinition,
      selectedAgentState,
      selectedAgentResources,
      selectedAgentFiles,
      selectedAgentPreview,
      sharedResources,
      shellStateMetadata,
      selectAgent,
      selectContextAndAgent,
      createContext,
      getAgentState: (agentId: string) =>
        normalizeAgentShellState(normalizedStates[normalizeSelectedAgentId(agentId)]),
      updateAgentState,
      replaceAgentResources: replaceResourcesForAgent,
      removeAgentResource: removeResourceForAgent,
      clearAgentState: clearAgentStateById,
      clearSelectedAgentState: () => clearAgentStateById(selectedAgentId),
      handleSelectFiles,
      resolveResource,
      getPreviewResources,
    }),
    [
      activeContext?.id,
      activeContext?.name,
      clearAgentStateById,
      createContext,
      currentUserId,
      getPreviewResources,
      handleSelectFiles,
      hydrated,
      normalizedContexts,
      normalizedStates,
      removeResourceForAgent,
      replaceResourcesForAgent,
      resolveResource,
      selectAgent,
      selectContextAndAgent,
      selectedAgentDefinition,
      selectedAgentFiles,
      selectedAgentId,
      selectedAgentPreview,
      selectedAgentResources,
      selectedAgentState,
      sharedResources,
      shellStateMetadata,
      updateAgentState,
    ],
  );

  return <AgentShellContext.Provider value={value}>{children}</AgentShellContext.Provider>;
}

export function useAgentShell() {
  const context = useContext(AgentShellContext);
  if (!context) {
    throw new Error("useAgentShell must be used within WorkspaceProvider.");
  }
  return context;
}

export function useOptionalAgentShell() {
  return useContext(AgentShellContext);
}
