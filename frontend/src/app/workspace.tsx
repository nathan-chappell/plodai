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
  listBreadcrumbs,
  loadWorkspaceFilesystem,
  loadWorkspaceRegistry,
  loadWorkspaceSurfaceState,
  normalizePathPrefix,
  removeWorkspaceEntry,
  resolveWorkspacePath,
  saveWorkspaceFilesystem,
  saveWorkspaceRegistry,
  saveWorkspaceSurfaceState,
} from "../lib/workspace-fs";
import { devLogger } from "../lib/dev-logging";
import { buildWorkspaceFile } from "../lib/workspace-files";
import { isVisibleWorkspaceStatePath } from "../lib/workspace-contract";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceBreadcrumb,
  WorkspaceContext,
  WorkspaceDescriptor,
  WorkspaceFilesystem,
  WorkspaceItem,
  WorkspaceRegistry,
} from "../types/workspace";

const UPLOADED_WORKSPACE_PREFIX = "/uploaded/";

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

function defaultPrefix(path: string): string {
  return normalizePathPrefix(path.endsWith("/") ? path : `${path}/`);
}

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
  return listAllWorkspaceFileNodes(filesystem).filter((item) =>
    isVisibleWorkspaceStatePath(item.path),
  );
}

function buildVisibleWorkspaceContext(filesystem: WorkspaceFilesystem): WorkspaceContext {
  return {
    path_prefix: "/",
    referenced_item_ids: listVisibleEntries(filesystem).map((entry) => entry.id),
  };
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
      activateDemoWorkspace,
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
  defaultCwdPath: string;
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
  const fallbackPrefix = useMemo(() => defaultPrefix(options.defaultCwdPath), [options.defaultCwdPath]);
  const [activePrefix, setActivePrefix] = useState(fallbackPrefix);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef({
    activePrefix: fallbackPrefix,
    cwdPath: fallbackPrefix,
    files: [] as LocalWorkspaceFile[],
    entries: [] as WorkspaceItem[],
    filesystem: createWorkspaceFilesystem(),
    workspaceContext: {
      path_prefix: "/",
      referenced_item_ids: [] as string[],
    } satisfies WorkspaceContext,
  });

  useEffect(() => {
    setHydrated(false);
    if (!currentUserId) {
      setActivePrefix(fallbackPrefix);
      return;
    }

    let cancelled = false;

    void (async () => {
      const storedState = await loadWorkspaceSurfaceState(currentUserId, selectedWorkspaceId, options.surfaceKey);
      if (cancelled) {
        return;
      }

      setActivePrefix(storedState?.active_prefix ?? fallbackPrefix);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, fallbackPrefix, options.surfaceKey, selectedWorkspaceId]);

  const resolvedFilesystem = useMemo(
    () => filesystemsByWorkspaceId[selectedWorkspaceId] ?? createWorkspaceFilesystem(),
    [filesystemsByWorkspaceId, selectedWorkspaceId],
  );
  const safeActivePrefix = useMemo(
    () => normalizePathPrefix(activePrefix || fallbackPrefix),
    [activePrefix, fallbackPrefix],
  );
  const entries = useMemo(() => listVisibleEntries(resolvedFilesystem), [resolvedFilesystem]);
  const files = useMemo(() => entries.map((item) => item.file), [entries]);
  const breadcrumbs = useMemo<WorkspaceBreadcrumb[]>(
    () => listBreadcrumbs(resolvedFilesystem, safeActivePrefix),
    [resolvedFilesystem, safeActivePrefix],
  );
  const workspaceContext = useMemo<WorkspaceContext>(
    () => buildVisibleWorkspaceContext(resolvedFilesystem),
    [resolvedFilesystem],
  );

  useEffect(() => {
    if (activePrefix !== safeActivePrefix) {
      setActivePrefix(safeActivePrefix);
    }
  }, [activePrefix, safeActivePrefix]);

  useEffect(() => {
    stateRef.current = {
      activePrefix: safeActivePrefix,
      cwdPath: safeActivePrefix,
      files,
      entries,
      filesystem: resolvedFilesystem,
      workspaceContext,
    };
  }, [entries, files, resolvedFilesystem, safeActivePrefix, workspaceContext]);

  useEffect(() => {
    if (!currentUserId || !hydrated) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceSurfaceState(currentUserId, selectedWorkspaceId, {
        surface_key: options.surfaceKey,
        active_prefix: safeActivePrefix,
      });
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, hydrated, options.surfaceKey, safeActivePrefix, selectedWorkspaceId]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    devLogger.workspaceEvent({
      surfaceKey: options.surfaceKey,
      event: "surface.state",
      pathPrefix: safeActivePrefix,
      entryCount: entries.length,
      fileCount: files.length,
      detail: {
        filesystemHydrated,
        surfaceHydrated: hydrated,
        selectedWorkspaceId,
        selectedWorkspaceKind: selectedWorkspace.kind,
      },
    });
  }, [
    currentUserId,
    entries.length,
    files.length,
    filesystemHydrated,
    hydrated,
    options.surfaceKey,
    safeActivePrefix,
    selectedWorkspace.id,
    selectedWorkspace.kind,
    selectedWorkspaceId,
  ]);

  const syncState = useCallback(
    (nextFilesystem: WorkspaceFilesystem, nextPrefix: string) => {
      const resolvedPrefix = normalizePathPrefix(nextPrefix || fallbackPrefix);
      stateRef.current = {
        activePrefix: resolvedPrefix,
        cwdPath: resolvedPrefix,
        files: listVisibleEntries(nextFilesystem).map((item) => item.file),
        entries: listVisibleEntries(nextFilesystem),
        filesystem: nextFilesystem,
        workspaceContext: buildVisibleWorkspaceContext(nextFilesystem),
      };
    },
    [fallbackPrefix],
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
        const nextFilesystem = addWorkspaceFiles(currentFilesystem, UPLOADED_WORKSPACE_PREFIX, builtFiles, "uploaded");
        syncState(nextFilesystem, stateRef.current.activePrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "files.uploaded",
        pathPrefix: UPLOADED_WORKSPACE_PREFIX,
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
      const nextPrefix = stateRef.current.activePrefix;
      let storedFiles: LocalWorkspaceFile[] = [];
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const result = addWorkspaceFilesWithResult(currentFilesystem, nextPrefix, nextFiles, source);
        storedFiles = result.files;
        syncState(result.filesystem, nextPrefix);
        return result.filesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "files.demo_appended" : "files.appended",
        pathPrefix: nextPrefix,
        fileCount: storedFiles.length,
        detail: {
          ...summarizeFiles(storedFiles),
          workspaceId: selectedWorkspaceId,
        },
      });
      return storedFiles;
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const replaceFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "demo" | "derived" = "demo") => {
      const nextPrefix = stateRef.current.activePrefix;
      setWorkspaceFilesystem(selectedWorkspaceId, () => {
        let nextFilesystem = createWorkspaceFilesystem();
        if (nextFiles.length) {
          nextFilesystem = addWorkspaceFiles(nextFilesystem, nextPrefix, nextFiles, source);
        }
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "workspace.reset.demo" : "workspace.reset.derived",
        pathPrefix: nextPrefix,
        fileCount: nextFiles.length,
        detail: {
          ...summarizeFiles(nextFiles),
          workspaceId: selectedWorkspaceId,
        },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const handleRemoveEntry = useCallback(
    (entryId: string) => {
      const nextPrefix = stateRef.current.activePrefix;
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = removeWorkspaceEntry(currentFilesystem, entryId);
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "entry.removed",
        pathPrefix: nextPrefix,
        detail: { entryId, workspaceId: selectedWorkspaceId },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const changePrefix = useCallback(
    (path: string, event: "prefix.selected" | "prefix.changed") => {
      const nextPrefix = normalizePathPrefix(resolveWorkspacePath(path, stateRef.current.activePrefix));
      syncState(stateRef.current.filesystem, nextPrefix);
      setActivePrefix(nextPrefix);
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event,
        pathPrefix: nextPrefix,
        detail: { path: nextPrefix, workspaceId: selectedWorkspaceId },
      });
      return nextPrefix;
    },
    [options.surfaceKey, selectedWorkspaceId, syncState],
  );

  const createDirectory = useCallback((path: string) => changePrefix(path, "prefix.selected"), [changePrefix]);
  const changeDirectory = useCallback((path: string) => changePrefix(path, "prefix.changed"), [changePrefix]);

  const setActivePrefixDirect = useCallback(
    (nextPrefix: string) => {
      setActivePrefix(normalizePathPrefix(nextPrefix || fallbackPrefix));
    },
    [fallbackPrefix],
  );

  const updateFilesystem = useCallback(
    (updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem) => {
      const nextPrefix = stateRef.current.activePrefix;
      setWorkspaceFilesystem(selectedWorkspaceId, (currentFilesystem) => {
        const nextFilesystem = updater(currentFilesystem);
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "filesystem.updated",
        pathPrefix: nextPrefix,
        detail: { workspaceId: selectedWorkspaceId },
      });
    },
    [options.surfaceKey, selectedWorkspaceId, setWorkspaceFilesystem, syncState],
  );

  const getState = useCallback(() => stateRef.current, []);

  return {
    activePrefix: safeActivePrefix,
    cwdPath: safeActivePrefix,
    files,
    entries,
    filesystem: resolvedFilesystem,
    breadcrumbs,
    workspaceContext,
    hydrated: filesystemHydrated && hydrated,
    filesystemHydrated,
    surfaceHydrated: hydrated,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspaceName: selectedWorkspace.name,
    selectedWorkspaceKind: selectedWorkspace.kind,
    appendFiles,
    replaceFiles,
    handleSelectFiles,
    handleRemoveEntry,
    createDirectory,
    changeDirectory,
    setActivePrefix: setActivePrefixDirect,
    setCwdPath: setActivePrefixDirect,
    updateFilesystem,
    getState,
    selectWorkspace,
    createWorkspace,
    clearWorkspace: () => clearWorkspace(selectedWorkspaceId),
    activateDemoWorkspace,
    restorePreviousWorkspace,
  };
}
