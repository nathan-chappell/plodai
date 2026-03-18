import {
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
import { buildWorkspaceFile } from "../lib/workspace-files";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceBreadcrumb, WorkspaceContext, WorkspaceFilesystem, WorkspaceItem } from "../types/workspace";

type WorkspaceStoreContextValue = {
  filesystem: WorkspaceFilesystem;
  setFilesystem: Dispatch<SetStateAction<WorkspaceFilesystem>>;
  currentUserId: string | null;
};

const WorkspaceStoreContext = createContext<WorkspaceStoreContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAppState();
  const [filesystem, setFilesystem] = useState<WorkspaceFilesystem>(createWorkspaceFilesystem());
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (!currentUserId) {
      setFilesystem(createWorkspaceFilesystem());
      return;
    }

    let cancelled = false;

    void (async () => {
      const nextFilesystem = await loadWorkspaceFilesystem(currentUserId);
      if (!cancelled) {
        setFilesystem(nextFilesystem);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveWorkspaceFilesystem(currentUserId, filesystem);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, filesystem]);

  const value = useMemo(
    () => ({
      filesystem,
      setFilesystem,
      currentUserId,
    }),
    [currentUserId, filesystem],
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
  const { filesystem, setFilesystem, currentUserId } = useWorkspaceStore();
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

  function syncState(nextFilesystem: WorkspaceFilesystem, nextCwdPath: string) {
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
  }

  async function handleSelectFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) {
      return;
    }
    const builtFiles = await Promise.all(Array.from(nextFiles).map((file) => buildWorkspaceFile(file)));
    const nextFilesystem = addWorkspaceFiles(resolvedFilesystem, safeCwdPath, builtFiles, "uploaded");
    syncState(nextFilesystem, safeCwdPath);
    setFilesystem(nextFilesystem);
  }

  function appendFiles(nextFiles: LocalWorkspaceFile[], source: "derived" | "demo" = "derived") {
    let storedFiles: LocalWorkspaceFile[] = [];
    const result = addWorkspaceFilesWithResult(resolvedFilesystem, safeCwdPath, nextFiles, source);
    storedFiles = result.files;
    syncState(result.filesystem, safeCwdPath);
    setFilesystem(result.filesystem);
    return storedFiles;
  }

  function replaceFiles(nextFiles: LocalWorkspaceFile[], source: "demo" | "derived" = "demo") {
    const nextFilesystem = replaceDirectoryFiles(resolvedFilesystem, safeCwdPath, nextFiles, source);
    syncState(nextFilesystem, safeCwdPath);
    setFilesystem(nextFilesystem);
  }

  function handleRemoveEntry(entryId: string) {
    const nextFilesystem = removeWorkspaceEntry(resolvedFilesystem, entryId);
    syncState(nextFilesystem, safeCwdPath);
    setFilesystem(nextFilesystem);
  }

  function createDirectory(path: string) {
    const resolvedPath = resolveWorkspacePath(path, safeCwdPath);
    const result = ensureDirectoryPath(resolvedFilesystem, resolvedPath);
    syncState(result.filesystem, safeCwdPath);
    setFilesystem(result.filesystem);
    return resolvedPath;
  }

  function changeDirectory(path: string) {
    const resolvedPath = resolveWorkspacePath(path, safeCwdPath);
    const directory = getDirectoryByPath(resolvedFilesystem, resolvedPath);
    syncState(resolvedFilesystem, directory.path);
    setCwdPath(directory.path);
    return directory.path;
  }

  function setCwdPathDirect(nextPath: string) {
    setCwdPath(resolveWorkspacePath(nextPath, safeCwdPath));
  }

  function updateFilesystem(
    updater: (filesystem: WorkspaceFilesystem) => WorkspaceFilesystem,
  ) {
    const nextFilesystem = updater(resolvedFilesystem);
    syncState(nextFilesystem, safeCwdPath);
    setFilesystem(nextFilesystem);
  }

  return {
    cwdPath: safeCwdPath,
    files,
    entries,
    filesystem: resolvedFilesystem,
    breadcrumbs,
    workspaceContext,
    hydrated,
    appendFiles,
    replaceFiles,
    handleSelectFiles,
    handleRemoveEntry,
    createDirectory,
    changeDirectory,
    setCwdPath: setCwdPathDirect,
    updateFilesystem,
    getState: () => stateRef.current,
  };
}
