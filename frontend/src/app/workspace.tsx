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
import { WorkspaceRepository } from "../lib/workspace-repository";
import { buildWorkspaceFile } from "../lib/workspace-files";
import type { LocalAttachment } from "../types/report";
import type {
  ApplyWorkspaceItemOperationPayload,
  WorkspaceAppId,
  WorkspaceItemCreatePayload,
  WorkspaceCreatedItemDetail,
  WorkspaceItemRevision,
  WorkspaceCreatedItemSummary,
  WorkspaceListItem,
  WorkspaceState,
  WorkspaceUpdatePayload,
  WorkspaceUploadItemSummary,
} from "../types/workspace";

const DEFAULT_WORKSPACE_NAME_BY_APP: Record<WorkspaceAppId, string> = {
  plodai: "Farm",
  documents: "Documents",
};

type CreateWorkspaceOptions = {
  appId?: WorkspaceAppId;
  name?: string;
};

type HandleSelectFilesOptions = {
  workspaceId?: string;
  appId?: WorkspaceAppId;
};

type PendingComposerLaunch = {
  appId: WorkspaceAppId;
  workspaceId: string;
  prompt: string;
  model?: string | null;
};

type AgentShellContextValue = {
  currentUserId: string | null;
  currentAppId: WorkspaceAppId | null;
  hydrated: boolean;
  workspaces: WorkspaceListItem[];
  activeWorkspace: WorkspaceState | null;
  activeWorkspaceId: string | null;
  activeWorkspaceName: string;
  selectedFileId: string | null;
  selectedArtifactId: string | null;
  currentReportArtifactId: string | null;
  listFiles: () => WorkspaceUploadItemSummary[];
  getFile: (fileId: string) => WorkspaceUploadItemSummary | null;
  resolveLocalFile: (fileId: string) => Promise<LocalAttachment | null>;
  registerFile: (
    file: LocalAttachment,
    options?: {
      sourceItemId?: string | null;
    },
  ) => Promise<WorkspaceUploadItemSummary>;
  listArtifacts: () => WorkspaceCreatedItemSummary[];
  getArtifact: (artifactId: string) => Promise<WorkspaceCreatedItemDetail | null>;
  listArtifactRevisions: (artifactId: string) => Promise<WorkspaceItemRevision[]>;
  createArtifact: (
    payload: WorkspaceItemCreatePayload,
  ) => Promise<WorkspaceCreatedItemDetail>;
  deleteArtifact: (artifactId: string) => Promise<void>;
  applyArtifactOperation: (
    artifactId: string,
    payload: ApplyWorkspaceItemOperationPayload,
  ) => Promise<WorkspaceCreatedItemDetail>;
  updateWorkspace: (payload: WorkspaceUpdatePayload) => Promise<WorkspaceState | null>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (options?: CreateWorkspaceOptions) => Promise<string>;
  handleSelectFiles: (
    files: FileList | Iterable<File> | null | undefined,
    options?: HandleSelectFilesOptions,
  ) => Promise<LocalAttachment[]>;
  removeWorkspaceFile: (fileId: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  queuePendingComposerLaunch: (launch: PendingComposerLaunch | null) => void;
  consumePendingComposerLaunch: (
    appId: WorkspaceAppId,
    workspaceId: string,
  ) => PendingComposerLaunch | null;
};

const AgentShellContext = createContext<AgentShellContextValue | null>(null);

function toFileArray(files: FileList | Iterable<File> | null | undefined): File[] {
  if (!files) {
    return [];
  }
  if (typeof FileList !== "undefined" && files instanceof FileList) {
    return Array.from(files);
  }
  return Array.from(files);
}

function baseWorkspaceName(appId: WorkspaceAppId): string {
  return DEFAULT_WORKSPACE_NAME_BY_APP[appId];
}

function nextWorkspaceName(
  appId: WorkspaceAppId,
  workspaces: WorkspaceListItem[],
): string {
  const baseName = baseWorkspaceName(appId);
  const used = new Set(workspaces.map((workspace) => workspace.name.trim().toLowerCase()));
  if (!used.has(baseName.toLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (used.has(`${baseName.toLowerCase()} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function WorkspaceProvider({
  appId,
  children,
}: {
  appId: WorkspaceAppId | null;
  children: ReactNode;
}) {
  const { user } = useAppState();
  const currentUserId = user?.id ?? null;
  const repositoryRef = useRef<WorkspaceRepository | null>(null);
  if (repositoryRef.current === null) {
    repositoryRef.current = new WorkspaceRepository();
  }
  const repository = repositoryRef.current;

  const [hydrated, setHydrated] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceState | null>(null);
  const [pendingComposerLaunch, setPendingComposerLaunch] =
    useState<PendingComposerLaunch | null>(null);

  const refreshWorkspaceList = useCallback(
    async (targetAppId: WorkspaceAppId) => {
      const nextWorkspaces = await repository.listWorkspaces(targetAppId);
      setWorkspaces(nextWorkspaces);
      return nextWorkspaces;
    },
    [repository],
  );

  const loadWorkspace = useCallback(
    async (workspaceId: string, targetAppId: WorkspaceAppId) => {
      const state = await repository.loadWorkspace(workspaceId, targetAppId);
      setActiveWorkspace(state);
      return state;
    },
    [repository],
  );

  useEffect(() => {
    if (!currentUserId) {
      setHydrated(false);
      setWorkspaces([]);
      setActiveWorkspace(null);
      return;
    }

    if (!appId) {
      setWorkspaces([]);
      setActiveWorkspace(null);
      setHydrated(true);
      return;
    }

    let cancelled = false;
    setHydrated(false);

    void (async () => {
      const queuedLaunch =
        pendingComposerLaunch?.appId === appId ? pendingComposerLaunch : null;
      const state = queuedLaunch
        ? await repository.loadWorkspace(queuedLaunch.workspaceId, appId)
        : await repository.ensureWorkspace(appId);
      const nextWorkspaces = await repository.listWorkspaces(appId);
      if (cancelled) {
        return;
      }
      setActiveWorkspace(state);
      setWorkspaces(nextWorkspaces);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [appId, currentUserId, pendingComposerLaunch, repository]);

  const refreshWorkspace = useCallback(async () => {
    if (!activeWorkspace?.workspace_id || !appId) {
      return;
    }
    const [state] = await Promise.all([
      loadWorkspace(activeWorkspace.workspace_id, appId),
      refreshWorkspaceList(appId),
    ]);
    setActiveWorkspace(state);
  }, [activeWorkspace?.workspace_id, appId, loadWorkspace, refreshWorkspaceList]);

  const updateWorkspace = useCallback(
    async (payload: WorkspaceUpdatePayload) => {
      if (!activeWorkspace?.workspace_id || !appId) {
        return null;
      }
      const [state] = await Promise.all([
        repository.updateWorkspace(activeWorkspace.workspace_id, appId, payload),
        refreshWorkspaceList(appId),
      ]);
      setActiveWorkspace(state);
      return state;
    },
    [activeWorkspace?.workspace_id, appId, refreshWorkspaceList, repository],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!appId) {
        return;
      }
      await loadWorkspace(workspaceId, appId);
      setWorkspaces(await repository.listWorkspaces(appId));
    },
    [appId, loadWorkspace, repository],
  );

  const createWorkspace = useCallback(
    async (options?: CreateWorkspaceOptions) => {
      const targetAppId = options?.appId ?? appId;
      if (!targetAppId) {
        throw new Error("No workspace app is available.");
      }
      const state = await repository.createWorkspace(
        options?.name?.trim() || nextWorkspaceName(targetAppId, workspaces),
        targetAppId,
      );
      if (appId === targetAppId) {
        setActiveWorkspace(state);
        setWorkspaces(await repository.listWorkspaces(targetAppId));
      }
      return state.workspace_id;
    },
    [appId, repository, workspaces],
  );

  const handleSelectFiles = useCallback(
    async (
      files: FileList | Iterable<File> | null | undefined,
      options?: HandleSelectFilesOptions,
    ) => {
      const targetWorkspaceId = options?.workspaceId ?? activeWorkspace?.workspace_id;
      if (!targetWorkspaceId) {
        return [];
      }
      const targetAppId = options?.appId ?? activeWorkspace?.app_id ?? appId;
      if (!targetAppId) {
        return [];
      }
      const nextFiles = toFileArray(files);
      if (!nextFiles.length) {
        return [];
      }
      const builtFiles = await Promise.all(nextFiles.map((file) => buildWorkspaceFile(file)));
      await Promise.all(
        builtFiles.map((file) => repository.createUpload(targetWorkspaceId, file)),
      );
      if (targetWorkspaceId === activeWorkspace?.workspace_id) {
        await refreshWorkspace();
      } else if (appId === targetAppId) {
        setWorkspaces(await repository.listWorkspaces(targetAppId));
      }
      return builtFiles;
    },
    [activeWorkspace?.app_id, activeWorkspace?.workspace_id, appId, refreshWorkspace, repository],
  );

  const removeWorkspaceFile = useCallback(
    async (fileId: string) => {
      if (!activeWorkspace?.workspace_id) {
        return;
      }
      await repository.deleteUpload(activeWorkspace.workspace_id, fileId);
      await refreshWorkspace();
    },
    [activeWorkspace?.workspace_id, refreshWorkspace, repository],
  );

  const listFiles = useCallback(
    () =>
      activeWorkspace?.items.filter(
        (item): item is WorkspaceUploadItemSummary => item.origin === "upload",
      ) ?? [],
    [activeWorkspace?.items],
  );

  const getFile = useCallback(
    (fileId: string) =>
      activeWorkspace?.items.find(
        (item): item is WorkspaceUploadItemSummary =>
          item.origin === "upload" && item.id === fileId,
      ) ?? null,
    [activeWorkspace?.items],
  );

  const resolveLocalFile = useCallback(
    async (fileId: string) => {
      const file =
        activeWorkspace?.items.find(
          (entry): entry is WorkspaceUploadItemSummary =>
            entry.origin === "upload" && entry.id === fileId,
        ) ?? null;
      if (!file) {
        return null;
      }
      return repository.resolveLocalAttachment(file);
    },
    [activeWorkspace?.items, repository],
  );

  const registerFile = useCallback(
    async (
      file: LocalAttachment,
      options?: {
        sourceItemId?: string | null;
      },
    ) => {
      if (!activeWorkspace?.workspace_id) {
        throw new Error("No active workspace is available.");
      }
      const entry = await repository.createUpload(activeWorkspace.workspace_id, file, {
        sourceItemId: options?.sourceItemId ?? null,
      });
      await refreshWorkspace();
      return entry;
    },
    [activeWorkspace?.workspace_id, refreshWorkspace, repository],
  );

  const listArtifacts = useCallback(
    () =>
      activeWorkspace?.items.filter(
        (item): item is WorkspaceCreatedItemSummary => item.origin === "created",
      ) ?? [],
    [activeWorkspace?.items],
  );

  const getArtifact = useCallback(
    async (artifactId: string) => {
      if (!activeWorkspace?.workspace_id) {
        return null;
      }
      return repository.getItem(activeWorkspace.workspace_id, artifactId);
    },
    [activeWorkspace?.workspace_id, repository],
  );

  const listArtifactRevisions = useCallback(
    async (artifactId: string) => {
      if (!activeWorkspace?.workspace_id) {
        return [];
      }
      return repository.listItemRevisions(activeWorkspace.workspace_id, artifactId);
    },
    [activeWorkspace?.workspace_id, repository],
  );

  const createArtifact = useCallback(
    async (payload: WorkspaceItemCreatePayload) => {
      if (!activeWorkspace?.workspace_id) {
        throw new Error("No active workspace is available.");
      }
      const detail = await repository.createItem(activeWorkspace.workspace_id, payload);
      await refreshWorkspace();
      return detail;
    },
    [activeWorkspace?.workspace_id, refreshWorkspace, repository],
  );

  const applyArtifactOperation = useCallback(
    async (artifactId: string, payload: ApplyWorkspaceItemOperationPayload) => {
      if (!activeWorkspace?.workspace_id) {
        throw new Error("No active workspace is available.");
      }
      const detail = await repository.applyItemOperation(
        activeWorkspace.workspace_id,
        artifactId,
        payload,
      );
      await refreshWorkspace();
      return detail;
    },
    [activeWorkspace?.workspace_id, refreshWorkspace, repository],
  );

  const deleteArtifact = useCallback(
    async (artifactId: string) => {
      if (!activeWorkspace?.workspace_id) {
        throw new Error("No active workspace is available.");
      }
      await repository.deleteItem(activeWorkspace.workspace_id, artifactId);
      await refreshWorkspace();
    },
    [activeWorkspace?.workspace_id, refreshWorkspace, repository],
  );

  const queuePendingComposerLaunch = useCallback(
    (launch: PendingComposerLaunch | null) => {
      setPendingComposerLaunch(launch);
    },
    [],
  );

  const consumePendingComposerLaunch = useCallback(
    (targetAppId: WorkspaceAppId, workspaceId: string) => {
      let nextLaunch: PendingComposerLaunch | null = null;
      setPendingComposerLaunch((current) => {
        if (!current) {
          return current;
        }
        if (current.appId !== targetAppId || current.workspaceId !== workspaceId) {
          return current;
        }
        nextLaunch = current;
        return null;
      });
      return nextLaunch;
    },
    [],
  );

  const value = useMemo<AgentShellContextValue>(
    () => ({
      currentUserId,
      currentAppId: appId,
      hydrated,
      workspaces,
      activeWorkspace,
      activeWorkspaceId: activeWorkspace?.workspace_id ?? null,
      activeWorkspaceName:
        activeWorkspace?.workspace_name ??
        (appId ? baseWorkspaceName(appId) : "Workspace"),
      selectedFileId:
        listFiles().find((item) => item.id === activeWorkspace?.selected_item_id)?.id ?? null,
      selectedArtifactId:
        listArtifacts().find((item) => item.id === activeWorkspace?.selected_item_id)?.id ?? null,
      currentReportArtifactId: activeWorkspace?.current_report_item_id ?? null,
      listFiles,
      getFile,
      resolveLocalFile,
      registerFile,
      listArtifacts,
      getArtifact,
      listArtifactRevisions,
      createArtifact,
      deleteArtifact,
      applyArtifactOperation,
      updateWorkspace,
      selectWorkspace,
      createWorkspace,
      handleSelectFiles,
      removeWorkspaceFile,
      refreshWorkspace,
      queuePendingComposerLaunch,
      consumePendingComposerLaunch,
    }),
    [
      activeWorkspace,
      appId,
      applyArtifactOperation,
      createArtifact,
      createWorkspace,
      currentUserId,
      deleteArtifact,
      getArtifact,
      getFile,
      handleSelectFiles,
      hydrated,
      listArtifactRevisions,
      listArtifacts,
      listFiles,
      queuePendingComposerLaunch,
      consumePendingComposerLaunch,
      refreshWorkspace,
      registerFile,
      removeWorkspaceFile,
      resolveLocalFile,
      selectWorkspace,
      updateWorkspace,
      workspaces,
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
