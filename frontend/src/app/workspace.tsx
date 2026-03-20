import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAppState } from "./context";
import {
  DEMO_WORKSPACE_ID,
  DEFAULT_WORKSPACE_ID,
  addWorkspaceFiles,
  addWorkspaceFilesWithResult,
  createWorkspaceDescriptor,
  createWorkspaceFilesystem,
  createWorkspaceRegistry,
  getWorkspaceContext,
  listAllWorkspaceFileNodes,
  loadWorkspaceFilesystem,
  loadWorkspaceRegistry,
  loadWorkspaceSurfaceState,
  removeWorkspaceEntry,
  replaceWorkspaceFiles,
  saveWorkspaceFilesystem,
  saveWorkspaceRegistry,
  saveWorkspaceSurfaceState,
} from "../lib/workspace-fs";
import { devLogger } from "../lib/dev-logging";
import { buildWorkspaceFile } from "../lib/workspace-files";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceContext,
  WorkspaceDescriptor,
  WorkspaceFilesystem,
  WorkspaceItem,
  WorkspaceRegistry,
} from "../types/workspace";

type WorkspaceStoreContextValue = {
  currentUserId: string | null;
  filesystemHydrated: boolean;
  filesystemsByWorkspaceId: Record<string, WorkspaceFilesystem>;
  workspaces: WorkspaceDescriptor[];
  selectedWorkspaceId: string;
  selectedWorkspace: WorkspaceDescriptor;
  setWorkspaceFilesystem: (
    workspaceId: string,
    updater: WorkspaceFilesystem | ((filesystem: WorkspaceFilesystem) => WorkspaceFilesystem),
  ) => void;
  selectWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string) => WorkspaceDescriptor | null;
  clearWorkspace: (workspaceId: string) => void;
  activateDemoWorkspace: () => void;
  restorePreviousWorkspace: () => void;
};

const WorkspaceStoreContext = createContext<WorkspaceStoreContextValue | null>(null);

function normalizeFilesystems(
  registry: WorkspaceRegistry,
  filesystems: Record<string, WorkspaceFilesystem>,
): Record<string, WorkspaceFilesystem> {
  return Object.fromEntries(
    registry.workspaces.map((workspace) => [
      workspace.id,
      filesystems[workspace.id] ?? createWorkspaceFilesystem(),
    ]),
  );
}

function listVisibleEntries(filesystem: WorkspaceFilesystem): WorkspaceItem[] {
  return listAllWorkspaceFileNodes(filesystem);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAppState();
  const currentUserId = user?.id ?? null;
  const [registry, setRegistry] = useState<WorkspaceRegistry>(() => createWorkspaceRegistry());
  const [filesystemsByWorkspaceId, setFilesystemsByWorkspaceId] = useState<Record<string, WorkspaceFilesystem>>({
    [DEFAULT_WORKSPACE_ID]: createWorkspaceFilesystem(),
    [DEMO_WORKSPACE_ID]: createWorkspaceFilesystem(),
  });
  const [filesystemHydrated, setFilesystemHydrated] = useState(false);
  const previousNonDemoWorkspaceIdRef = useRef(DEFAULT_WORKSPACE_ID);

  useEffect(() => {
    if (!currentUserId) {
      const nextRegistry = createWorkspaceRegistry();
      setRegistry(nextRegistry);
      setFilesystemsByWorkspaceId(normalizeFilesystems(nextRegistry, {}));
      setFilesystemHydrated(false);
      previousNonDemoWorkspaceIdRef.current = DEFAULT_WORKSPACE_ID;
      return;
    }

    let cancelled = false;
    setFilesystemHydrated(false);

    void (async () => {
      const nextRegistry = await loadWorkspaceRegistry(currentUserId);
      const loadedFilesystems = await Promise.all(
        nextRegistry.workspaces.map(async (workspace) => [
          workspace.id,
          await loadWorkspaceFilesystem(currentUserId, workspace.id),
        ] as const),
      );
      if (cancelled) {
        return;
      }
      const nextFilesystems = Object.fromEntries(loadedFilesystems);
      setRegistry(nextRegistry);
      setFilesystemsByWorkspaceId(normalizeFilesystems(nextRegistry, nextFilesystems));
      previousNonDemoWorkspaceIdRef.current =
        nextRegistry.workspaces.find((workspace) => workspace.id === nextRegistry.selected_workspace_id)?.kind === "demo"
          ? DEFAULT_WORKSPACE_ID
          : nextRegistry.selected_workspace_id;
      setFilesystemHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || !filesystemHydrated) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const normalizedFilesystems = normalizeFilesystems(registry, filesystemsByWorkspaceId);
      void Promise.all([
        saveWorkspaceRegistry(currentUserId, registry),
        ...registry.workspaces.map((workspace) =>
          saveWorkspaceFilesystem(
            currentUserId,
            workspace.id,
            normalizedFilesystems[workspace.id] ?? createWorkspaceFilesystem(),
          ),
        ),
      ]).catch(() => undefined);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, filesystemHydrated, filesystemsByWorkspaceId, registry]);

  const selectedWorkspace = useMemo(
    () =>
      registry.workspaces.find((workspace) => workspace.id === registry.selected_workspace_id) ??
      registry.workspaces[0] ??
      createWorkspaceDescriptor("Default workspace", "default"),
    [registry],
  );

  useEffect(() => {
    if (selectedWorkspace.kind !== "demo") {
      previousNonDemoWorkspaceIdRef.current = selectedWorkspace.id;
    }
  }, [selectedWorkspace]);

  const setWorkspaceFilesystem = useCallback(
    (
      workspaceId: string,
      updater: WorkspaceFilesystem | ((filesystem: WorkspaceFilesystem) => WorkspaceFilesystem),
    ) => {
      setFilesystemsByWorkspaceId((current) => {
        const currentFilesystem = current[workspaceId] ?? createWorkspaceFilesystem();
        const nextFilesystem =
          typeof updater === "function"
            ? (updater as (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem)(currentFilesystem)
            : updater;
        return {
          ...current,
          [workspaceId]: nextFilesystem,
        };
      });
    },
    [],
  );

  const selectWorkspace = useCallback((workspaceId: string) => {
    setRegistry((current) => {
      if (!current.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return current;
      }
      return {
        ...current,
        selected_workspace_id: workspaceId,
      };
    });
  }, []);

  const createWorkspace = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }
    const descriptor = createWorkspaceDescriptor(trimmedName, "user");
    setRegistry((current) => ({
      ...current,
      selected_workspace_id: descriptor.id,
      workspaces: [...current.workspaces, descriptor],
    }));
    setFilesystemsByWorkspaceId((current) => ({
      ...current,
      [descriptor.id]: createWorkspaceFilesystem(),
    }));
    previousNonDemoWorkspaceIdRef.current = descriptor.id;
    return descriptor;
  }, []);

  const clearWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceFilesystem(workspaceId, createWorkspaceFilesystem());
  }, [setWorkspaceFilesystem]);

  const activateDemoWorkspace = useCallback(() => {
    if (selectedWorkspace.kind !== "demo") {
      previousNonDemoWorkspaceIdRef.current = selectedWorkspace.id;
    }
    selectWorkspace(DEMO_WORKSPACE_ID);
  }, [selectWorkspace, selectedWorkspace]);

  const restorePreviousWorkspace = useCallback(() => {
    const targetWorkspaceId = previousNonDemoWorkspaceIdRef.current || DEFAULT_WORKSPACE_ID;
    selectWorkspace(targetWorkspaceId);
  }, [selectWorkspace]);

  const value = useMemo(
    () => ({
      currentUserId,
      filesystemHydrated,
      filesystemsByWorkspaceId: normalizeFilesystems(registry, filesystemsByWorkspaceId),
      workspaces: registry.workspaces,
      selectedWorkspaceId: selectedWorkspace.id,
      selectedWorkspace,
      setWorkspaceFilesystem,
      selectWorkspace,
      createWorkspace,
      clearWorkspace,
      activateDemoWorkspace,
      restorePreviousWorkspace,
    }),
    [
      activateDemoWorkspace,
      clearWorkspace,
      createWorkspace,
      currentUserId,
      filesystemHydrated,
      filesystemsByWorkspaceId,
      registry,
      restorePreviousWorkspace,
      selectWorkspace,
      selectedWorkspace,
      setWorkspaceFilesystem,
    ],
  );

  return <WorkspaceStoreContext.Provider value={value}>{children}</WorkspaceStoreContext.Provider>;
}

function useWorkspaceStore() {
  const context = useContext(WorkspaceStoreContext);
  if (!context) {
    throw new Error("useWorkspaceStore must be used within WorkspaceProvider.");
  }
  return context;
}

export function useWorkspaceSurface(options: {
  surfaceKey: string;
  defaultCwdPath?: string;
}) {
  const {
    currentUserId,
    filesystemHydrated,
    filesystemsByWorkspaceId,
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    setWorkspaceFilesystem,
    selectWorkspace,
    createWorkspace,
    clearWorkspace,
    activateDemoWorkspace,
    restorePreviousWorkspace,
  } = useWorkspaceStore();
  const [activeSurfaceTab, setActiveSurfaceTab] = useState<string | null>(null);
  const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState<string | null>(null);
  const stateRef = useRef({
    workspaceId: selectedWorkspaceId,
    files: [] as LocalWorkspaceFile[],
    entries: [] as WorkspaceItem[],
    filesystem: createWorkspaceFilesystem(),
    workspaceContext: {
      workspace_id: selectedWorkspaceId,
      referenced_item_ids: [] as string[],
    } satisfies WorkspaceContext,
  });

  useEffect(() => {
    setHydratedWorkspaceId(null);
    if (!currentUserId) {
      setActiveSurfaceTab(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const storedState = await loadWorkspaceSurfaceState(currentUserId, selectedWorkspaceId, options.surfaceKey);
      if (cancelled) {
        return;
      }
      setActiveSurfaceTab(storedState?.active_tab ?? null);
      setHydratedWorkspaceId(selectedWorkspaceId);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, options.surfaceKey, selectedWorkspaceId]);

  const surfaceHydrated = hydratedWorkspaceId === selectedWorkspaceId;

  const resolvedFilesystem = useMemo(
    () => filesystemsByWorkspaceId[selectedWorkspaceId] ?? createWorkspaceFilesystem(),
    [filesystemsByWorkspaceId, selectedWorkspaceId],
  );
  const entries = useMemo(() => listVisibleEntries(resolvedFilesystem), [resolvedFilesystem]);
  const files = useMemo(() => entries.map((item) => item.file), [entries]);
  const workspaceContext = useMemo<WorkspaceContext>(
    () => getWorkspaceContext(resolvedFilesystem, selectedWorkspaceId),
    [resolvedFilesystem, selectedWorkspaceId],
  );

  useEffect(() => {
    stateRef.current = {
      workspaceId: selectedWorkspaceId,
      files,
      entries,
      filesystem: resolvedFilesystem,
      workspaceContext,
    };
  }, [entries, files, resolvedFilesystem, selectedWorkspaceId, workspaceContext]);

  useEffect(() => {
    if (!currentUserId || !surfaceHydrated) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceSurfaceState(currentUserId, selectedWorkspaceId, {
        surface_key: options.surfaceKey,
        active_tab: activeSurfaceTab,
      });
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeSurfaceTab,
    currentUserId,
    options.surfaceKey,
    selectedWorkspaceId,
    surfaceHydrated,
  ]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    devLogger.workspaceEvent({
      surfaceKey: options.surfaceKey,
      event: "surface.state",
      pathPrefix: selectedWorkspaceId,
      entryCount: entries.length,
      fileCount: files.length,
      detail: {
        filesystemHydrated,
        surfaceHydrated,
        selectedWorkspaceId,
        selectedWorkspaceKind: selectedWorkspace.kind,
      },
    });
  }, [
    currentUserId,
    entries.length,
    files.length,
    filesystemHydrated,
    options.surfaceKey,
    selectedWorkspace.id,
    selectedWorkspace.kind,
    selectedWorkspaceId,
    surfaceHydrated,
  ]);

  const syncState = useCallback(
    (nextFilesystem: WorkspaceFilesystem, workspaceId = selectedWorkspaceId) => {
      stateRef.current = {
        workspaceId,
        files: listVisibleEntries(nextFilesystem).map((item) => item.file),
        entries: listVisibleEntries(nextFilesystem),
        filesystem: nextFilesystem,
        workspaceContext: getWorkspaceContext(nextFilesystem, workspaceId),
      };
    },
    [selectedWorkspaceId],
  );

  function summarizeFiles(nextFiles: LocalWorkspaceFile[]): Record<string, unknown> {
    return {
      ids: nextFiles.map((file) => file.id),
      names: nextFiles.map((file) => file.name),
    };
  }

  const handleSelectFiles = useCallback(
    async (nextFiles: FileList | null) => {
      if (!nextFiles?.length) {
        return;
      }
      const builtFiles = await Promise.all(Array.from(nextFiles).map((file) => buildWorkspaceFile(file)));
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = addWorkspaceFiles(currentFilesystem, builtFiles, "uploaded", {
          bucket: "uploaded",
          producer_key: "uploaded",
          producer_label: "Uploaded",
        });
        syncState(nextFilesystem);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "files.uploaded",
        pathPrefix: selectedWorkspaceId,
        fileCount: builtFiles.length,
        detail: {
          ...summarizeFiles(builtFiles),
          workspaceId: selectedWorkspaceId,
        },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const appendFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "derived" | "demo" = "derived") => {
      let storedFiles: LocalWorkspaceFile[] = [];
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const result = addWorkspaceFilesWithResult(currentFilesystem, nextFiles, source, {
          bucket: source === "derived" ? undefined : "uploaded",
          producer_key: source === "derived" ? options.surfaceKey : "uploaded",
          producer_label: source === "derived" ? selectedWorkspace.name : "Uploaded",
        });
        storedFiles = result.files;
        syncState(result.filesystem);
        return result.filesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "files.demo_appended" : "files.appended",
        pathPrefix: selectedWorkspaceId,
        fileCount: storedFiles.length,
        detail: {
          ...summarizeFiles(storedFiles),
          workspaceId: selectedWorkspaceId,
        },
      });
      return storedFiles;
    },
    [options.surfaceKey, selectedWorkspace.name, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const replaceFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "demo" | "derived" = "demo") => {
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = replaceWorkspaceFiles(currentFilesystem, nextFiles, source, {
          bucket: source === "demo" ? "uploaded" : undefined,
          producer_key: source === "demo" ? "uploaded" : options.surfaceKey,
          producer_label: source === "demo" ? "Uploaded" : selectedWorkspace.name,
        });
        syncState(nextFilesystem);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "workspace.reset.demo" : "workspace.reset.derived",
        pathPrefix: selectedWorkspaceId,
        fileCount: nextFiles.length,
        detail: {
          ...summarizeFiles(nextFiles),
          workspaceId: selectedWorkspaceId,
        },
      });
    },
    [options.surfaceKey, selectedWorkspace.name, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const handleRemoveEntry = useCallback(
    (entryId: string) => {
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = removeWorkspaceEntry(currentFilesystem, entryId);
        syncState(nextFilesystem);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "entry.removed",
        pathPrefix: selectedWorkspaceId,
        detail: { entryId, workspaceId: selectedWorkspaceId },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const updateFilesystem = useCallback(
    (updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem) => {
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = updater(currentFilesystem);
        syncState(nextFilesystem);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "filesystem.updated",
        pathPrefix: selectedWorkspaceId,
        detail: { workspaceId: selectedWorkspaceId },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const getState = useCallback(() => stateRef.current, []);

  return {
    files,
    entries,
    filesystem: resolvedFilesystem,
    workspaceContext,
    hydrated: filesystemHydrated && surfaceHydrated,
    filesystemHydrated,
    surfaceHydrated,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspaceName: selectedWorkspace.name,
    selectedWorkspaceKind: selectedWorkspace.kind,
    activeSurfaceTab,
    appendFiles,
    replaceFiles,
    handleSelectFiles,
    handleRemoveEntry,
    updateFilesystem,
    getState,
    selectWorkspace,
    createWorkspace,
    clearWorkspace: () => clearWorkspace(selectedWorkspaceId),
    activateDemoWorkspace,
    restorePreviousWorkspace,
    setActiveSurfaceTab,
  };
}
