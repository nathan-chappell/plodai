import type { LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceBreadcrumb,
  WorkspaceContext,
  WorkspaceDirectoryNode,
  WorkspaceFileNode,
  WorkspaceFilesystem,
  WorkspaceItem,
  WorkspaceSurfaceState,
} from "../types/workspace";

const DATABASE_NAME = "ai-portfolio-workspace";
const DATABASE_VERSION = 1;
const FILESYSTEM_STORE = "workspace_filesystems";
const SURFACE_STATE_STORE = "workspace_surface_state";
const ROOT_DIRECTORY_ID = "workspace-root";

type WorkspaceFilesystemRecord = {
  key: string;
  filesystem: WorkspaceFilesystem;
};

type WorkspaceSurfaceStateRecord = {
  key: string;
  value: WorkspaceSurfaceState;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILESYSTEM_STORE)) {
        database.createObjectStore(FILESYSTEM_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(SURFACE_STATE_STORE)) {
        database.createObjectStore(SURFACE_STATE_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open the workspace database."));
  });

  return databasePromise;
}

function filesystemKey(userId: string): string {
  return `filesystem:${userId}`;
}

function surfaceStateKey(userId: string, surfaceKey: string): string {
  return `surface:${userId}:${surfaceKey}`;
}

export function createWorkspaceFilesystem(): WorkspaceFilesystem {
  return {
    root_id: ROOT_DIRECTORY_ID,
    items: [
      {
        id: ROOT_DIRECTORY_ID,
        kind: "directory",
        name: "",
        path: "/",
        parent_id: null,
        created_at: new Date().toISOString(),
      },
    ],
  };
}

export async function loadWorkspaceFilesystem(userId: string): Promise<WorkspaceFilesystem> {
  try {
    const database = await openDatabase();
    return await new Promise<WorkspaceFilesystem>((resolve, reject) => {
      const transaction = database.transaction(FILESYSTEM_STORE, "readonly");
      const store = transaction.objectStore(FILESYSTEM_STORE);
      const request = store.get(filesystemKey(userId));

      request.onsuccess = () => {
        const record = request.result as WorkspaceFilesystemRecord | undefined;
        resolve(record?.filesystem ? normalizeFilesystem(record.filesystem) : createWorkspaceFilesystem());
      };
      request.onerror = () => reject(request.error ?? new Error("Workspace filesystem read failed."));
    });
  } catch {
    return createWorkspaceFilesystem();
  }
}

export async function saveWorkspaceFilesystem(userId: string, filesystem: WorkspaceFilesystem): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FILESYSTEM_STORE, "readwrite");
    const store = transaction.objectStore(FILESYSTEM_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace filesystem write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace filesystem write failed."));

    store.put({
      key: filesystemKey(userId),
      filesystem: normalizeFilesystem(filesystem),
    } satisfies WorkspaceFilesystemRecord);
  });
}

export async function loadWorkspaceSurfaceState(
  userId: string,
  surfaceKey: string,
): Promise<WorkspaceSurfaceState | null> {
  try {
    const database = await openDatabase();
    return await new Promise<WorkspaceSurfaceState | null>((resolve, reject) => {
      const transaction = database.transaction(SURFACE_STATE_STORE, "readonly");
      const store = transaction.objectStore(SURFACE_STATE_STORE);
      const request = store.get(surfaceStateKey(userId, surfaceKey));

      request.onsuccess = () => {
        const record = request.result as WorkspaceSurfaceStateRecord | undefined;
        resolve(record?.value ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Workspace surface-state read failed."));
    });
  } catch {
    return null;
  }
}

export async function saveWorkspaceSurfaceState(
  userId: string,
  state: WorkspaceSurfaceState,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SURFACE_STATE_STORE, "readwrite");
    const store = transaction.objectStore(SURFACE_STATE_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace surface-state write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace surface-state write failed."));

    store.put({
      key: surfaceStateKey(userId, state.surface_key),
      value: { ...state, cwd_path: normalizeAbsolutePath(state.cwd_path) },
    } satisfies WorkspaceSurfaceStateRecord);
  });
}

export function normalizeAbsolutePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  const rawParts = trimmed ? trimmed.split("/") : [""];
  const stack: string[] = [];

  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!stack.length) {
        throw new Error("Workspace paths cannot escape the root directory.");
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.length ? `/${stack.join("/")}` : "/";
}

export function resolveWorkspacePath(path: string, cwdPath: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return normalizeAbsolutePath(cwdPath);
  }
  return normalizeAbsolutePath(trimmed.startsWith("/") ? trimmed : `${normalizeAbsolutePath(cwdPath)}/${trimmed}`);
}

export function getWorkspaceContext(filesystem: WorkspaceFilesystem, cwdPath: string): WorkspaceContext {
  const normalizedCwdPath = normalizeAbsolutePath(cwdPath);
  const entryIds = listDirectoryEntries(filesystem, normalizedCwdPath).map((entry) => entry.id);
  return {
    cwd_path: normalizedCwdPath,
    referenced_item_ids: entryIds,
  };
}

export function listDirectoryEntries(filesystem: WorkspaceFilesystem, cwdPath: string): WorkspaceItem[] {
  const directory = getDirectoryByPath(filesystem, cwdPath);
  return filesystem.items
    .filter((item) => item.parent_id === directory.id)
    .sort(compareWorkspaceItems);
}

export function listDirectoryFiles(filesystem: WorkspaceFilesystem, cwdPath: string): LocalWorkspaceFile[] {
  return listDirectoryEntries(filesystem, cwdPath)
    .filter((item): item is WorkspaceFileNode => item.kind === "file")
    .map((item) => item.file);
}

export function listBreadcrumbs(filesystem: WorkspaceFilesystem, cwdPath: string): WorkspaceBreadcrumb[] {
  const normalizedPath = normalizeAbsolutePath(cwdPath);
  const parts = normalizedPath === "/" ? [] : normalizedPath.slice(1).split("/");
  const breadcrumbs: WorkspaceBreadcrumb[] = [{ id: ROOT_DIRECTORY_ID, name: "/", path: "/" }];

  let nextPath = "";
  for (const part of parts) {
    nextPath += `/${part}`;
    const directory = getDirectoryByPath(filesystem, nextPath);
    breadcrumbs.push({
      id: directory.id,
      name: directory.name || "/",
      path: directory.path,
    });
  }

  return breadcrumbs;
}

export function ensureDirectoryPath(
  filesystem: WorkspaceFilesystem,
  requestedPath: string,
): { filesystem: WorkspaceFilesystem; directory: WorkspaceDirectoryNode; created: boolean } {
  const normalizedPath = normalizeAbsolutePath(requestedPath);
  const existingDirectory = findDirectoryByPath(filesystem, normalizedPath);
  if (existingDirectory) {
    return {
      filesystem,
      directory: existingDirectory,
      created: false,
    };
  }

  const nextFilesystem = normalizeFilesystem(filesystem);
  const parts = normalizedPath === "/" ? [] : normalizedPath.slice(1).split("/");
  let parent = getRootDirectory(nextFilesystem);
  let created = false;

  for (const part of parts) {
    const candidatePath = parent.path === "/" ? `/${part}` : `${parent.path}/${part}`;
    const existing = findDirectoryByPath(nextFilesystem, candidatePath);
    if (existing) {
      parent = existing;
      continue;
    }

    const directory: WorkspaceDirectoryNode = {
      id: crypto.randomUUID(),
      kind: "directory",
      name: part,
      path: candidatePath,
      parent_id: parent.id,
      created_at: new Date().toISOString(),
    };
    nextFilesystem.items.push(directory);
    parent = directory;
    created = true;
  }

  return {
    filesystem: nextFilesystem,
    directory: parent,
    created,
  };
}

export function addWorkspaceFiles(
  filesystem: WorkspaceFilesystem,
  cwdPath: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  return addWorkspaceFilesWithResult(filesystem, cwdPath, files, source).filesystem;
}

export function addWorkspaceFilesWithResult(
  filesystem: WorkspaceFilesystem,
  cwdPath: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  if (!files.length) {
    return { filesystem: normalizeFilesystem(filesystem), files: [] };
  }

  const normalizedFilesystem = normalizeFilesystem(filesystem);
  const directory = getDirectoryByPath(normalizedFilesystem, cwdPath);
  const storedFiles: LocalWorkspaceFile[] = [];

  for (const file of files) {
    const dedupedName = ensureUniqueChildName(normalizedFilesystem, directory.id, file.name);
    const nextFile: LocalWorkspaceFile = {
      ...file,
      name: dedupedName,
    };
    normalizedFilesystem.items.push({
      id: nextFile.id,
      kind: "file",
      name: dedupedName,
      path: directory.path === "/" ? `/${dedupedName}` : `${directory.path}/${dedupedName}`,
      parent_id: directory.id,
      created_at: new Date().toISOString(),
      source,
      file: nextFile,
    });
    storedFiles.push(nextFile);
  }

  return {
    filesystem: normalizedFilesystem,
    files: storedFiles,
  };
}

export function replaceDirectoryFiles(
  filesystem: WorkspaceFilesystem,
  cwdPath: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  const directory = getDirectoryByPath(normalizedFilesystem, cwdPath);
  normalizedFilesystem.items = normalizedFilesystem.items.filter(
    (item) => !(item.parent_id === directory.id && item.kind === "file"),
  );
  return addWorkspaceFiles(normalizedFilesystem, cwdPath, files, source);
}

export function removeWorkspaceEntry(filesystem: WorkspaceFilesystem, entryId: string): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  const entry = normalizedFilesystem.items.find((item) => item.id === entryId);
  if (!entry || entry.id === ROOT_DIRECTORY_ID) {
    return normalizedFilesystem;
  }

  if (entry.kind === "directory") {
    const hasChildren = normalizedFilesystem.items.some((item) => item.parent_id === entry.id);
    if (hasChildren) {
      throw new Error("Only empty directories can be removed in this phase.");
    }
  }

  normalizedFilesystem.items = normalizedFilesystem.items.filter((item) => item.id !== entryId);
  return normalizedFilesystem;
}

export function getDirectoryByPath(filesystem: WorkspaceFilesystem, path: string): WorkspaceDirectoryNode {
  const normalizedPath = normalizeAbsolutePath(path);
  const directory = findDirectoryByPath(filesystem, normalizedPath);
  if (!directory) {
    throw new Error(`Unknown workspace directory: ${normalizedPath}`);
  }
  return directory;
}

export function summarizeWorkspaceFile(fileNode: WorkspaceFileNode): Record<string, unknown> {
  const file = fileNode.file;
  return {
    id: file.id,
    name: file.name,
    path: fileNode.path,
    kind: file.kind,
    extension: file.extension,
    byte_size: file.byte_size,
    mime_type: file.mime_type,
    ...(file.kind === "csv" || file.kind === "json"
      ? {
          row_count: file.row_count,
          columns: file.columns,
          numeric_columns: file.numeric_columns,
          sample_rows: file.sample_rows,
        }
      : {}),
    ...(file.kind === "pdf"
      ? {
          page_count: file.page_count,
        }
      : {}),
  };
}

export function summarizeWorkspaceDirectory(directory: WorkspaceDirectoryNode): Record<string, unknown> {
  return {
    id: directory.id,
    name: directory.name || "/",
    kind: "directory",
    path: directory.path,
  };
}

function getRootDirectory(filesystem: WorkspaceFilesystem): WorkspaceDirectoryNode {
  const root = filesystem.items.find((item): item is WorkspaceDirectoryNode => item.kind === "directory" && item.id === ROOT_DIRECTORY_ID);
  if (!root) {
    throw new Error("Workspace root directory is missing.");
  }
  return root;
}

function findDirectoryByPath(filesystem: WorkspaceFilesystem, path: string): WorkspaceDirectoryNode | null {
  const normalizedPath = normalizeAbsolutePath(path);
  return (
    filesystem.items.find(
      (item): item is WorkspaceDirectoryNode => item.kind === "directory" && item.path === normalizedPath,
    ) ?? null
  );
}

function ensureUniqueChildName(filesystem: WorkspaceFilesystem, parentId: string, requestedName: string): string {
  const trimmed = requestedName.trim() || "untitled";
  const siblings = new Set(
    filesystem.items.filter((item) => item.parent_id === parentId).map((item) => item.name.toLowerCase()),
  );
  if (!siblings.has(trimmed.toLowerCase())) {
    return trimmed;
  }

  const dotIndex = trimmed.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < trimmed.length - 1;
  const stem = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const extension = hasExtension ? trimmed.slice(dotIndex) : "";
  let counter = 2;

  while (siblings.has(`${stem} (${counter})${extension}`.toLowerCase())) {
    counter += 1;
  }

  return `${stem} (${counter})${extension}`;
}

function compareWorkspaceItems(left: WorkspaceItem, right: WorkspaceItem): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function normalizeFilesystem(filesystem: WorkspaceFilesystem): WorkspaceFilesystem {
  const nextFilesystem: WorkspaceFilesystem = {
    root_id: filesystem.root_id || ROOT_DIRECTORY_ID,
    items: [...filesystem.items],
  };

  const hasRoot = nextFilesystem.items.some(
    (item) => item.kind === "directory" && item.id === ROOT_DIRECTORY_ID && item.path === "/",
  );
  if (!hasRoot) {
    nextFilesystem.items.unshift({
      id: ROOT_DIRECTORY_ID,
      kind: "directory",
      name: "",
      path: "/",
      parent_id: null,
      created_at: new Date().toISOString(),
    });
  }

  return nextFilesystem;
}
