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
  ensureDirectoryPath,
  getDirectoryByPath,
  getWorkspaceContext,
  listBreadcrumbs,
  listDirectoryEntries,
  listDirectoryFiles,
  loadWorkspaceFilesystem,
  loadWorkspaceSurfaceState,
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
  const [cwdPath, setCwdPath] = useState(options.defaultCwdPath);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef({
    cwdPath: options.defaultCwdPath,
    files: [] as LocalWorkspaceFile[],
    entries: [] as WorkspaceItem[],
    filesystem: createWorkspaceFilesystem(),
    workspaceContext: {
      cwd_path: options.defaultCwdPath,
      referenced_item_ids: [] as string[],
    },
  });

  useEffect(() => {
    setHydrated(false);
    if (!currentUserId) {
      setCwdPath(options.defaultCwdPath);
      return;
    }

    let cancelled = false;
    setFilesystem((current) => ensureDirectoryPath(current, options.defaultCwdPath).filesystem);

    void (async () => {
      const storedState = await loadWorkspaceSurfaceState(currentUserId, options.surfaceKey);
      if (cancelled) {
        return;
      }

      setCwdPath(storedState?.cwd_path ?? options.defaultCwdPath);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, options.defaultCwdPath, options.surfaceKey, setFilesystem]);

  const resolvedFilesystem = useMemo(
    () => ensureDirectoryPath(filesystem, options.defaultCwdPath).filesystem,
    [filesystem, options.defaultCwdPath],
  );
  const safeCwdPath = useMemo(() => {
    try {
      return getDirectoryByPath(resolvedFilesystem, cwdPath).path;
    } catch {
      return options.defaultCwdPath;
    }
  }, [cwdPath, options.defaultCwdPath, resolvedFilesystem]);

  useEffect(() => {
    if (cwdPath !== safeCwdPath) {
      setCwdPath(safeCwdPath);
    }
  }, [cwdPath, safeCwdPath]);

  useEffect(() => {
    if (!currentUserId || !hydrated) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceSurfaceState(currentUserId, {
        surface_key: options.surfaceKey,
        cwd_path: safeCwdPath,
      });
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, hydrated, options.surfaceKey, safeCwdPath]);

  const entries = useMemo(() => listDirectoryEntries(resolvedFilesystem, safeCwdPath), [resolvedFilesystem, safeCwdPath]);
  const files = useMemo(() => listDirectoryFiles(resolvedFilesystem, safeCwdPath), [resolvedFilesystem, safeCwdPath]);
  const breadcrumbs = useMemo<WorkspaceBreadcrumb[]>(
    () => listBreadcrumbs(resolvedFilesystem, safeCwdPath),
    [resolvedFilesystem, safeCwdPath],
  );
  const workspaceContext = useMemo<WorkspaceContext>(
    () => getWorkspaceContext(resolvedFilesystem, safeCwdPath),
    [resolvedFilesystem, safeCwdPath],
  );

  useEffect(() => {
    stateRef.current = {
      cwdPath: safeCwdPath,
      files,
      entries,
      filesystem: resolvedFilesystem,
      workspaceContext,
    };
  }, [entries, files, resolvedFilesystem, safeCwdPath, workspaceContext]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    devLogger.workspaceEvent({
      surfaceKey: options.surfaceKey,
      event: "surface.state",
      cwdPath: safeCwdPath,
      entryCount: entries.length,
      fileCount: files.length,
      detail: {
        filesystemHydrated,
        surfaceHydrated: hydrated,
      },
    });
  }, [currentUserId, entries.length, files.length, filesystemHydrated, hydrated, options.surfaceKey, safeCwdPath]);

  const syncState = useCallback(
    (nextFilesystem: WorkspaceFilesystem, nextCwdPath: string) => {
      let resolvedCwdPath = nextCwdPath;
      try {
        resolvedCwdPath = getDirectoryByPath(nextFilesystem, nextCwdPath).path;
      } catch {
        resolvedCwdPath = options.defaultCwdPath;
      }
      stateRef.current = {
        cwdPath: resolvedCwdPath,
        files: listDirectoryFiles(nextFilesystem, resolvedCwdPath),
        entries: listDirectoryEntries(nextFilesystem, resolvedCwdPath),
        filesystem: nextFilesystem,
        workspaceContext: getWorkspaceContext(nextFilesystem, resolvedCwdPath),
      };
    },
    [options.defaultCwdPath],
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
      const activeCwdPath = stateRef.current.cwdPath;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = addWorkspaceFiles(currentFilesystem, activeCwdPath, builtFiles, "uploaded");
        syncState(nextFilesystem, activeCwdPath);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "files.uploaded",
        cwdPath: activeCwdPath,
        fileCount: builtFiles.length,
        detail: summarizeFiles(builtFiles),
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const appendFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "derived" | "demo" = "derived") => {
      const activeCwdPath = stateRef.current.cwdPath;
      let storedFiles: LocalWorkspaceFile[] = [];
      setFilesystem((currentFilesystem) => {
        const result = addWorkspaceFilesWithResult(currentFilesystem, activeCwdPath, nextFiles, source);
        storedFiles = result.files;
        syncState(result.filesystem, activeCwdPath);
        return result.filesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "files.demo_appended" : "files.appended",
        cwdPath: activeCwdPath,
        fileCount: storedFiles.length,
        detail: summarizeFiles(storedFiles),
      });
      return storedFiles;
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const replaceFiles = useCallback(
    (nextFiles: LocalWorkspaceFile[], source: "demo" | "derived" = "demo") => {
      const activeCwdPath = stateRef.current.cwdPath;
      const currentFiles = stateRef.current.files;
      const alreadySeeded =
        currentFiles.length === nextFiles.length &&
        currentFiles.every((file, index) => file.id === nextFiles[index]?.id);
      if (alreadySeeded) {
        devLogger.workspaceEvent({
          surfaceKey: options.surfaceKey,
          event: source === "demo" ? "files.demo_replace_skipped" : "files.replace_skipped",
          cwdPath: activeCwdPath,
          fileCount: currentFiles.length,
          detail: summarizeFiles(currentFiles),
        });
        return;
      }
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = replaceDirectoryFiles(currentFilesystem, activeCwdPath, nextFiles, source);
        syncState(nextFilesystem, activeCwdPath);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: source === "demo" ? "files.demo_replaced" : "files.replaced",
        cwdPath: activeCwdPath,
        fileCount: nextFiles.length,
        detail: summarizeFiles(nextFiles),
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const handleRemoveEntry = useCallback(
    (entryId: string) => {
      const activeCwdPath = stateRef.current.cwdPath;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = removeWorkspaceEntry(currentFilesystem, entryId);
        syncState(nextFilesystem, activeCwdPath);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "entry.removed",
        cwdPath: activeCwdPath,
        detail: { entryId },
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const createDirectory = useCallback(
    (path: string) => {
      const activeCwdPath = stateRef.current.cwdPath;
      const resolvedPath = resolveWorkspacePath(path, activeCwdPath);
      setFilesystem((currentFilesystem) => {
        const result = ensureDirectoryPath(currentFilesystem, resolvedPath);
        syncState(result.filesystem, activeCwdPath);
        return result.filesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "directory.created",
        cwdPath: activeCwdPath,
        detail: { path: resolvedPath },
      });
      return resolvedPath;
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const changeDirectory = useCallback(
    (path: string) => {
      const currentState = stateRef.current;
      const resolvedPath = resolveWorkspacePath(path, currentState.cwdPath);
      const directory = getDirectoryByPath(currentState.filesystem, resolvedPath);
      syncState(currentState.filesystem, directory.path);
      setCwdPath(directory.path);
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "directory.changed",
        cwdPath: directory.path,
        detail: { path: resolvedPath },
      });
      return directory.path;
    },
    [options.surfaceKey, syncState],
  );

  const setCwdPathDirect = useCallback(
    (nextPath: string) => {
      setCwdPath(resolveWorkspacePath(nextPath, safeCwdPath));
    },
    [safeCwdPath],
  );

  const updateFilesystem = useCallback(
    (updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem) => {
      const activeCwdPath = stateRef.current.cwdPath;
      setFilesystem((currentFilesystem) => {
        const nextFilesystem = updater(currentFilesystem);
        syncState(nextFilesystem, activeCwdPath);
        return nextFilesystem;
      });
      devLogger.workspaceEvent({
        surfaceKey: options.surfaceKey,
        event: "filesystem.updated",
        cwdPath: activeCwdPath,
      });
    },
    [options.surfaceKey, setFilesystem, syncState],
  );

  const getState = useCallback(() => stateRef.current, []);

  return {
    cwdPath: safeCwdPath,
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
    setCwdPath: setCwdPathDirect,
    updateFilesystem,
    getState,
  };
}
