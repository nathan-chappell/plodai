import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAppState } from "./context";
import {
  clearAgentShellState,
  clearLegacyWorkspaceState,
  loadAgentShellState,
  loadSelectedAgentId,
  saveAgentShellState,
  saveSelectedAgentId,
} from "../lib/agent-shell-store";
import { buildShellStateMetadata } from "../lib/shell-metadata";
import {
  buildResourceFromFile,
  buildAgentPreviewModel,
  createEmptyAgentShellState,
  listFileResources,
  normalizeAgentShellState,
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
} from "../types/shell";

const DEFAULT_AGENT_ID = "help-agent";
const PERSISTED_AGENT_IDS = runtimeAgentDefinitions
  .filter((agent) => agent.id !== "feedback-agent")
  .map((agent) => agent.id);

type AgentShellContextValue = {
  currentUserId: string | null;
  hydrated: boolean;
  selectedAgentId: string;
  selectedAgentDefinition: AgentDefinition;
  selectedAgentState: AgentShellState;
  selectedAgentResources: AgentResourceRecord[];
  selectedAgentFiles: LocalWorkspaceFile[];
  selectedAgentPreview: AgentPreviewModel;
  sharedResources: AgentResourceRecord[];
  shellStateMetadata: ShellStateMetadata;
  selectAgent: (agentId: string) => void;
  getAgentState: (agentId: string) => AgentShellState;
  updateAgentState: (
    agentId: string,
    updater: (state: AgentShellState) => AgentShellState,
  ) => void;
  replaceAgentResources: (agentId: string, resources: AgentResourceRecord[]) => void;
  clearAgentState: (agentId: string) => void;
  clearSelectedAgentState: () => void;
  handleSelectFiles: (agentId: string, files: FileList | null) => Promise<void>;
  resolveResource: (resourceId: string) => AgentResourceRecord | null;
  getPreviewResources: (agentId: string) => AgentResourceRecord[];
};

const AgentShellContext = createContext<AgentShellContextValue | null>(null);

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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAppState();
  const currentUserId = user?.id ?? null;
  const [selectedAgentId, setSelectedAgentId] = useState<string>(DEFAULT_AGENT_ID);
  const [statesByAgentId, setStatesByAgentId] = useState<Record<string, AgentShellState>>(
    buildInitialStates(),
  );
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = hydrated;
  }, [hydrated]);

  useEffect(() => {
    if (!currentUserId) {
      setSelectedAgentId(DEFAULT_AGENT_ID);
      setStatesByAgentId(buildInitialStates());
      setHydrated(false);
      return;
    }

    let cancelled = false;
    setHydrated(false);

    void (async () => {
      await clearLegacyWorkspaceState(currentUserId, PERSISTED_AGENT_IDS);
      const [storedSelectedAgentId, ...storedStates] = await Promise.all([
        loadSelectedAgentId(currentUserId),
        ...PERSISTED_AGENT_IDS.map((agentId) => loadAgentShellState(currentUserId, agentId)),
      ]);
      if (cancelled) {
        return;
      }
      setSelectedAgentId(normalizeSelectedAgentId(storedSelectedAgentId));
      setStatesByAgentId(
        normalizeStates(
          Object.fromEntries(
            PERSISTED_AGENT_IDS.map((agentId, index) => [
              agentId,
              storedStates[index] ?? createEmptyAgentShellState(),
            ]),
          ),
        ),
      );
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

    const normalizedStates = normalizeStates(statesByAgentId);
    const timeoutId = window.setTimeout(() => {
      void Promise.all([
        saveSelectedAgentId(currentUserId, selectedAgentId),
        ...PERSISTED_AGENT_IDS.map((agentId) =>
          saveAgentShellState(currentUserId, agentId, normalizedStates[agentId]),
        ),
      ]).catch(() => undefined);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, hydrated, selectedAgentId, statesByAgentId]);

  const updateAgentState = useCallback(
    (agentId: string, updater: (state: AgentShellState) => AgentShellState) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      setStatesByAgentId((current) => {
        const currentState = normalizeAgentShellState(current[resolvedAgentId]);
        const nextState = normalizeAgentShellState(updater(currentState));
        return {
          ...current,
          [resolvedAgentId]: nextState,
        };
      });
    },
    [],
  );

  const replaceResourcesForAgent = useCallback(
    (agentId: string, resources: AgentResourceRecord[]) => {
      updateAgentState(agentId, (state) => replaceAgentResources(state, resources));
    },
    [updateAgentState],
  );

  const clearAgentStateById = useCallback(
    (agentId: string) => {
      const resolvedAgentId = normalizeSelectedAgentId(agentId);
      setStatesByAgentId((current) => ({
        ...current,
        [resolvedAgentId]: createEmptyAgentShellState(),
      }));
      if (currentUserId && hydratedRef.current) {
        void clearAgentShellState(currentUserId, resolvedAgentId).catch(() => undefined);
      }
    },
    [currentUserId],
  );

  const handleSelectFiles = useCallback(
    async (agentId: string, nextFiles: FileList | null) => {
      if (!nextFiles?.length) {
        return;
      }
      const ownerAgentId = normalizeSelectedAgentId(agentId);
      const builtFiles = await Promise.all(
        Array.from(nextFiles).map((file) => buildWorkspaceFile(file)),
      );
      const builtResources = builtFiles.map((file) => buildResourceFromFile(ownerAgentId, file));
      updateAgentState(ownerAgentId, (state) => ({
        ...state,
        resources: sortResources([...normalizeAgentShellState(state).resources, ...builtResources]),
      }));
    },
    [updateAgentState],
  );

  const normalizedStates = useMemo(
    () => normalizeStates(statesByAgentId),
    [statesByAgentId],
  );
  const selectedAgentDefinition =
    getAgentDefinition(selectedAgentId) ?? getAgentDefinition(DEFAULT_AGENT_ID)!;

  const sharedResources = useMemo(
    () =>
      Object.values(normalizedStates)
        .flatMap((state) => state.resources)
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.title.localeCompare(right.title)),
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
        activeAgentId: selectedAgentId,
        statesByAgentId: normalizedStates,
      }),
    [normalizedStates, selectedAgentId],
  );

  const value = useMemo<AgentShellContextValue>(
    () => ({
      currentUserId,
      hydrated,
      selectedAgentId,
      selectedAgentDefinition,
      selectedAgentState,
      selectedAgentResources,
      selectedAgentFiles,
      selectedAgentPreview,
      sharedResources,
      shellStateMetadata,
      selectAgent: (agentId: string) => setSelectedAgentId(normalizeSelectedAgentId(agentId)),
      getAgentState: (agentId: string) =>
        normalizeAgentShellState(normalizedStates[normalizeSelectedAgentId(agentId)]),
      updateAgentState,
      replaceAgentResources: replaceResourcesForAgent,
      clearAgentState: clearAgentStateById,
      clearSelectedAgentState: () => clearAgentStateById(selectedAgentId),
      handleSelectFiles,
      resolveResource,
      getPreviewResources,
    }),
    [
      clearAgentStateById,
      currentUserId,
      getPreviewResources,
      handleSelectFiles,
      hydrated,
      normalizedStates,
      replaceResourcesForAgent,
      resolveResource,
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
