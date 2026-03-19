import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useAppState } from "./context";
import {
  addWorkspaceFiles,
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
  listBreadcrumbs,
  listDirectoryEntries,
  listDirectoryFiles,
  loadWorkspaceFilesystem,
  loadWorkspaceSurfaceState,
  normalizePathPrefix,
  removeWorkspaceEntry,
  replaceDirectoryFiles,
  resolveWorkspacePath,
  saveWorkspaceFilesystem,
  saveWorkspaceSurfaceState,
} from "../lib/workspace-fs";
import { devLogger } from "../lib/dev-logging";
import { buildWorkspaceFile } from "../lib/workspace-files";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceBreadcrumb, WorkspaceContext, WorkspaceFilesystem, WorkspaceItem } from "../types/workspace";

type WorkspaceStoreContextValue = {
  filesystem: WorkspaceFilesystem;
  setFilesystem: Dispatch<SetStateAction<WorkspaceFilesystem>>;
  currentUserId: string | null;
  filesystemHydrated: boolean;
};

const WorkspaceStoreContext = createContext<WorkspaceStoreContextValue | null>(null);

function defaultPrefix(path: string): string {
  return normalizePathPrefix(path.endsWith("/") ? path : `${path}/`);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAppState();
  const [filesystem, setFilesystem] = useState<WorkspaceFilesystem>(createWorkspaceFilesystem());
  const [filesystemHydrated, setFilesystemHydrated] = useState(false);
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (!currentUserId) {
      setFilesystem(createWorkspaceFilesystem());
      setFilesystemHydrated(false);
      return;
    }

    let cancelled = false;
    setFilesystemHydrated(false);

    void (async () => {
      const nextFilesystem = await loadWorkspaceFilesystem(currentUserId);
      if (!cancelled) {
        setFilesystem(nextFilesystem);
        setFilesystemHydrated(true);
      }
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
      void saveWorkspaceFilesystem(currentUserId, filesystem);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, filesystem, filesystemHydrated]);

  const value = useMemo(
    () => ({
      filesystem,
      setFilesystem,
      currentUserId,
      filesystemHydrated,
    }),
    [currentUserId, filesystem, filesystemHydrated],
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
  const { filesystem, setFilesystem, currentUserId, filesystemHydrated } = useWorkspaceStore();
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
      path_prefix: fallbackPrefix,
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
      const storedState = await loadWorkspaceSurfaceState(currentUserId, options.surfaceKey);
      if (cancelled) {
        return;
      }

      setActivePrefix(storedState?.active_prefix ?? fallbackPrefix);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, fallbackPrefix, options.surfaceKey]);

  const resolvedFilesystem = useMemo(() => filesystem, [filesystem]);
  const safeActivePrefix = useMemo(() => normalizePathPrefix(activePrefix || fallbackPrefix), [activePrefix, fallbackPrefix]);

  useEffect(() => {
    if (activePrefix !== safeActivePrefix) {
      setActivePrefix(safeActivePrefix);
    }
  }, [activePrefix, safeActivePrefix]);

  useEffect(() => {
    if (!currentUserId || !hydrated) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceSurfaceState(currentUserId, {
        surface_key: options.surfaceKey,
        active_prefix: safeActivePrefix,
      });
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, hydrated, options.surfaceKey, safeActivePrefix]);

  const entries = useMemo(() => listDirectoryEntries(resolvedFilesystem, safeActivePrefix), [resolvedFilesystem, safeActivePrefix]);
  const files = useMemo(() => listDirectoryFiles(resolvedFilesystem, safeActivePrefix), [resolvedFilesystem, safeActivePrefix]);
  const breadcrumbs = useMemo<WorkspaceBreadcrumb[]>(
    () => listBreadcrumbs(resolvedFilesystem, safeActivePrefix),
    [resolvedFilesystem, safeActivePrefix],
  );
  const workspaceContext = useMemo<WorkspaceContext>(
    () => getWorkspaceContext(resolvedFilesystem, safeActivePrefix),
    [resolvedFilesystem, safeActivePrefix],
  );

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
      },
    });
  }, [currentUserId, entries.length, files.length, filesystemHydrated, hydrated, options.surfaceKey, safeActivePrefix]);

  const syncState = useCallback((nextFilesystem: WorkspaceFilesystem, nextPrefix: string) => {
    const resolvedPrefix = normalizePathPrefix(nextPrefix || fallbackPrefix);
    stateRef.current = {
      activePrefix: resolvedPrefix,
      cwdPath: resolvedPrefix,
      files: listDirectoryFiles(nextFilesystem, resolvedPrefix),
      entries: listDirectoryEntries(nextFilesystem, resolvedPrefix),
      filesystem: nextFilesystem,
      workspaceContext: getWorkspaceContext(nextFilesystem, resolvedPrefix),
    };
  }, [fallbackPrefix]);

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
      const nextPrefix = stateRef.current.activePrefix;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = addWorkspaceFiles(currentFilesystem, nextPrefix, builtFiles, "uploaded");
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "files.uploaded",
        pathPrefix: nextPrefix,
        fileCount: builtFiles.length,
        detail: summarizeFiles(builtFiles),
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const appendFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "derived" | "demo" = "derived") => {
      const nextPrefix = stateRef.current.activePrefix;
      let storedFiles: LocalWorkspaceFile[] = [];
      setFilesystem((currentFilesystem) => {
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
        detail: summarizeFiles(storedFiles),
      });
      return storedFiles;
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const replaceFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "demo" | "derived" = "demo") => {
      const nextPrefix = stateRef.current.activePrefix;
      const currentFiles = stateRef.current.files;
      const alreadySeeded =
        currentFiles.length === nextFiles.length &&
        currentFiles.every((file, index) => file.id === nextFiles[index]?.id);
      if (alreadySeeded) {
        devLogger.workspaceEvent({
          surfaceKey: options.surfaceKey,
          event: source === "demo" ? "files.demo_replace_skipped" : "files.replace_skipped",
          pathPrefix: nextPrefix,
          fileCount: currentFiles.length,
          detail: summarizeFiles(currentFiles),
        });
        return;
      }
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = replaceDirectoryFiles(currentFilesystem, nextPrefix, nextFiles, source);
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "files.demo_replaced" : "files.replaced",
        pathPrefix: nextPrefix,
        fileCount: nextFiles.length,
        detail: summarizeFiles(nextFiles),
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const handleRemoveEntry = useCallback(
    (entryId: string) => {
      const nextPrefix = stateRef.current.activePrefix;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = removeWorkspaceEntry(currentFilesystem, entryId);
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "entry.removed",
        pathPrefix: nextPrefix,
        detail: { entryId },
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const createDirectory = useCallback(
    (path: string) => {
      const nextPrefix = normalizePathPrefix(resolveWorkspacePath(path, stateRef.current.activePrefix));
      syncState(stateRef.current.filesystem, nextPrefix);
      setActivePrefix(nextPrefix);
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "prefix.selected",
        pathPrefix: nextPrefix,
        detail: { path: nextPrefix },
      });
      return nextPrefix;
    },
    [options.surfaceKey, syncState],
  );

  const changeDirectory = useCallback(
    (path: string) => {
      const nextPrefix = normalizePathPrefix(resolveWorkspacePath(path, stateRef.current.activePrefix));
      syncState(stateRef.current.filesystem, nextPrefix);
      setActivePrefix(nextPrefix);
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "prefix.changed",
        pathPrefix: nextPrefix,
        detail: { path: nextPrefix },
      });
      return nextPrefix;
    },
    [options.surfaceKey, syncState],
  );

  const setActivePrefixDirect = useCallback(
    (nextPrefix: string) => {
      setActivePrefix(normalizePathPrefix(nextPrefix || fallbackPrefix));
    },
    [fallbackPrefix],
  );

  const updateFilesystem = useCallback(
    (updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem) => {
      const nextPrefix = stateRef.current.activePrefix;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = updater(currentFilesystem);
        syncState(nextFilesystem, nextPrefix);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "filesystem.updated",
        pathPrefix: nextPrefix,
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
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
  };
}
