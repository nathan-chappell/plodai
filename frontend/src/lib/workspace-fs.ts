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
const DATABASE_VERSION = 2;
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

type WorkspaceFileWriteInput = {
  path: string;
  file: LocalWorkspaceFile;
  source: WorkspaceFileNode["source"];
  createdAt?: string;
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

    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion > 0) {
        if (database.objectStoreNames.contains(FILESYSTEM_STORE)) {
          database.deleteObjectStore(FILESYSTEM_STORE);
        }
        if (database.objectStoreNames.contains(SURFACE_STATE_STORE)) {
          database.deleteObjectStore(SURFACE_STATE_STORE);
        }
      }
      database.createObjectStore(FILESYSTEM_STORE, { keyPath: "key" });
      database.createObjectStore(SURFACE_STATE_STORE, { keyPath: "key" });
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

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function parentPrefixForPath(path: string): string {
  const normalizedPath = normalizeAbsolutePath(path);
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}/`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function withTrailingSlash(prefix: string): string {
  if (!prefix || prefix === "/") {
    return "/";
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function buildSyntheticDirectory(path: string): WorkspaceDirectoryNode {
  const normalizedPath = normalizeAbsolutePath(path);
  const parts = normalizedPath.split("/").filter(Boolean);
  const name = parts.at(-1) ?? "";
  const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/";
  return {
    id: normalizedPath === "/" ? ROOT_DIRECTORY_ID : `dir:${normalizedPath}`,
    kind: "directory",
    name,
    path: normalizedPath,
    parent_id: normalizedPath === "/" ? null : parentPath === "/" ? ROOT_DIRECTORY_ID : `dir:${parentPath}`,
    created_at: nowIso(),
  };
}

function compareWorkspaceItems(left: WorkspaceItem, right: WorkspaceItem): number {
  return left.path.localeCompare(right.path);
}

function normalizeWorkspaceFileNode(
  path: string,
  file: LocalWorkspaceFile,
  source: WorkspaceFileNode["source"],
  createdAt: string,
): WorkspaceFileNode {
  const normalizedPath = normalizeAbsolutePath(path);
  const normalizedName = basename(normalizedPath) || file.name || "untitled";
  return {
    id: file.id,
    kind: "file",
    name: normalizedName,
    path: normalizedPath,
    created_at: createdAt,
    source,
    file: {
      ...file,
      name: normalizedName,
    },
  };
}

function normalizeFilesystem(filesystem: WorkspaceFilesystem): WorkspaceFilesystem {
  const nextFilesByPath: Record<string, WorkspaceFileNode> = {};
  const sourceEntries = Object.entries(filesystem.files_by_path ?? {});
  for (const [rawPath, rawNode] of sourceEntries) {
    if (!rawNode || rawNode.kind !== "file" || !rawNode.file) {
      continue;
    }
    const normalizedPath = normalizeAbsolutePath(rawNode.path || rawPath);
    nextFilesByPath[normalizedPath] = normalizeWorkspaceFileNode(
      normalizedPath,
      rawNode.file,
      rawNode.source,
      rawNode.created_at || nowIso(),
    );
  }
  return {
    files_by_path: nextFilesByPath,
  };
}

function ensureUniquePath(filesystem: WorkspaceFilesystem, requestedPath: string): string {
  const normalizedPath = normalizeAbsolutePath(requestedPath);
  if (!filesystem.files_by_path[normalizedPath]) {
    return normalizedPath;
  }

  const pathParts = normalizedPath.split("/").filter(Boolean);
  const filename = pathParts.at(-1) ?? "untitled";
  const parentPath = pathParts.length > 1 ? `/${pathParts.slice(0, -1).join("/")}` : "/";
  const dotIndex = filename.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < filename.length - 1;
  const stem = hasExtension ? filename.slice(0, dotIndex) : filename;
  const extension = hasExtension ? filename.slice(dotIndex) : "";
  let counter = 2;

  while (true) {
    const candidateName = `${stem} (${counter})${extension}`;
    const candidatePath = parentPath === "/" ? `/${candidateName}` : `${parentPath}/${candidateName}`;
    if (!filesystem.files_by_path[candidatePath]) {
      return candidatePath;
    }
    counter += 1;
  }
}

function writeFiles(
  filesystem: WorkspaceFilesystem,
  files: WorkspaceFileWriteInput[],
  options: { dedupePaths: boolean },
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  const nextFilesystem = normalizeFilesystem(filesystem);
  const storedFiles: LocalWorkspaceFile[] = [];

  for (const input of files) {
    const normalizedRequestedPath = normalizeAbsolutePath(input.path);
    const targetPath = options.dedupePaths
      ? ensureUniquePath(nextFilesystem, normalizedRequestedPath)
      : normalizedRequestedPath;
    const nextNode = normalizeWorkspaceFileNode(
      targetPath,
      input.file,
      input.source,
      input.createdAt ?? nowIso(),
    );
    nextFilesystem.files_by_path[targetPath] = nextNode;
    storedFiles.push(nextNode.file);
  }

  return {
    filesystem: nextFilesystem,
    files: storedFiles,
  };
}

export function createWorkspaceFilesystem(): WorkspaceFilesystem {
  return {
    files_by_path: {},
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
      value: { ...state, active_prefix: normalizePathPrefix(state.active_prefix) },
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

export function normalizePathPrefix(inputPrefix: string): string {
  const trimmed = inputPrefix.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const wantsTrailingSlash = trimmed.endsWith("/");
  const normalizedPath = normalizeAbsolutePath(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
  if (normalizedPath === "/") {
    return "/";
  }
  return wantsTrailingSlash ? `${normalizedPath}/` : normalizedPath;
}

export function pathStartsWithPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizeAbsolutePath(path);
  const normalizedPrefix = prefix.trim() ? normalizePathPrefix(prefix) : "";
  if (!normalizedPrefix || normalizedPrefix === "/") {
    return true;
  }
  return normalizedPath.startsWith(normalizedPrefix);
}

export function resolveWorkspacePath(path: string, basePath: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return normalizeAbsolutePath(basePath);
  }
  return normalizeAbsolutePath(trimmed.startsWith("/") ? trimmed : `${normalizeAbsolutePath(basePath)}/${trimmed}`);
}

export function getWorkspaceContext(filesystem: WorkspaceFilesystem, pathPrefix: string): WorkspaceContext {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  const entryIds = listDirectoryEntries(filesystem, normalizedPrefix).map((entry) => entry.id);
  return {
    path_prefix: normalizedPrefix,
    referenced_item_ids: entryIds,
  };
}

export function listAllWorkspaceFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return Object.values(normalizeFilesystem(filesystem).files_by_path).sort(compareWorkspaceItems);
}

export function listAllWorkspaceFiles(filesystem: WorkspaceFilesystem): LocalWorkspaceFile[] {
  return listAllWorkspaceFileNodes(filesystem).map((node) => node.file);
}

export function listDirectoryEntries(filesystem: WorkspaceFilesystem, pathPrefix: string): WorkspaceItem[] {
  return listAllWorkspaceFileNodes(filesystem).filter((item) => pathStartsWithPrefix(item.path, pathPrefix));
}

export function listDirectoryFiles(filesystem: WorkspaceFilesystem, pathPrefix: string): LocalWorkspaceFile[] {
  return listDirectoryEntries(filesystem, pathPrefix).map((item) => item.file);
}

export function listBreadcrumbs(_filesystem: WorkspaceFilesystem, pathPrefix: string): WorkspaceBreadcrumb[] {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  const trimmedPrefix = normalizedPrefix === "/" ? "" : normalizedPrefix.replace(/\/$/, "");
  const parts = trimmedPrefix ? trimmedPrefix.slice(1).split("/") : [];
  const breadcrumbs: WorkspaceBreadcrumb[] = [{ id: ROOT_DIRECTORY_ID, name: "/", prefix: "/", path: "/" }];

  let nextPrefix = "";
  for (const part of parts) {
    nextPrefix += `/${part}`;
    breadcrumbs.push({
      id: `prefix:${nextPrefix}/`,
      name: part,
      prefix: withTrailingSlash(nextPrefix),
      path: withTrailingSlash(nextPrefix),
    });
  }
  return breadcrumbs;
}

export function ensureDirectoryPath(
  filesystem: WorkspaceFilesystem,
  requestedPath: string,
): { filesystem: WorkspaceFilesystem; directory: WorkspaceDirectoryNode; created: boolean } {
  const normalizedPath = normalizeAbsolutePath(requestedPath);
  return {
    filesystem: normalizeFilesystem(filesystem),
    directory: buildSyntheticDirectory(normalizedPath),
    created: false,
  };
}

export function addWorkspaceFiles(
  filesystem: WorkspaceFilesystem,
  pathPrefix: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  return addWorkspaceFilesWithResult(filesystem, pathPrefix, files, source).filesystem;
}

export function addWorkspaceFilesWithResult(
  filesystem: WorkspaceFilesystem,
  pathPrefix: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  if (!files.length) {
    return { filesystem: normalizeFilesystem(filesystem), files: [] };
  }

  const basePrefix = withTrailingSlash(normalizePathPrefix(pathPrefix));
  return writeFiles(
    filesystem,
    files.map((file) => ({
      path: resolveWorkspacePath(file.name, basePrefix === "/" ? "/" : basePrefix),
      file,
      source,
    })),
    { dedupePaths: true },
  );
}

export function addWorkspaceFilesAtPathsWithResult(
  filesystem: WorkspaceFilesystem,
  files: WorkspaceFileWriteInput[],
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  if (!files.length) {
    return { filesystem: normalizeFilesystem(filesystem), files: [] };
  }
  return writeFiles(filesystem, files, { dedupePaths: false });
}

export function replaceDirectoryFiles(
  filesystem: WorkspaceFilesystem,
  pathPrefix: string,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  const normalizedPrefix = withTrailingSlash(normalizePathPrefix(pathPrefix));
  const nextFilesystem = {
    files_by_path: Object.fromEntries(
      Object.entries(normalizedFilesystem.files_by_path).filter(
        ([path]) => parentPrefixForPath(path) !== normalizedPrefix,
      ),
    ),
  } satisfies WorkspaceFilesystem;
  return addWorkspaceFiles(nextFilesystem, normalizedPrefix, files, source);
}

export function removeWorkspaceEntry(filesystem: WorkspaceFilesystem, entryId: string): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  return {
    files_by_path: Object.fromEntries(
      Object.entries(normalizedFilesystem.files_by_path).filter(([, item]) => item.id !== entryId),
    ),
  };
}

export function removeWorkspaceFileByPath(filesystem: WorkspaceFilesystem, path: string): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  const normalizedPath = normalizeAbsolutePath(path);
  return {
    files_by_path: Object.fromEntries(
      Object.entries(normalizedFilesystem.files_by_path).filter(([candidatePath]) => candidatePath !== normalizedPath),
    ),
  };
}

export function removeWorkspacePrefix(filesystem: WorkspaceFilesystem, prefix: string): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  return {
    files_by_path: Object.fromEntries(
      Object.entries(normalizedFilesystem.files_by_path).filter(([path]) => !pathStartsWithPrefix(path, prefix)),
    ),
  };
}

export function findWorkspaceFileNodeById(filesystem: WorkspaceFilesystem, fileId: string): WorkspaceFileNode | null {
  return listAllWorkspaceFileNodes(filesystem).find((item) => item.id === fileId) ?? null;
}

export function findWorkspaceFileNodeByPath(filesystem: WorkspaceFilesystem, path: string): WorkspaceFileNode | null {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  return normalizedFilesystem.files_by_path[normalizeAbsolutePath(path)] ?? null;
}

export function getDirectoryByPath(_filesystem: WorkspaceFilesystem, path: string): WorkspaceDirectoryNode {
  return buildSyntheticDirectory(path);
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
