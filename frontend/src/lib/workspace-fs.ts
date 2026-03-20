import { getFileExtension } from "./workspace-files";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceArtifactBucket,
  WorkspaceAppStateV1,
  WorkspaceIndexV1,
  WorkspacePdfSmartSplitRegistryV1,
  WorkspaceReportIndexV1,
  WorkspaceReportV1,
  WorkspaceToolCatalogV1,
} from "../types/workspace-contract";
import type {
  WorkspaceContext,
  WorkspaceDescriptor,
  WorkspaceFileNode,
  WorkspaceFilesystem,
  WorkspaceItem,
  WorkspaceKind,
  WorkspaceRegistry,
  WorkspaceSurfaceState,
} from "../types/workspace";

const DATABASE_NAME = "ai-portfolio-workspace";
const DATABASE_VERSION = 4;
const FILESYSTEM_STORE = "workspace_filesystems";
const SURFACE_STATE_STORE = "workspace_surface_state";
const METADATA_STORE = "workspace_metadata";
export const DEFAULT_WORKSPACE_ID = "default";
export const DEMO_WORKSPACE_ID = "demo";
const WORKSPACE_REGISTRY_VERSION = "v1";

type WorkspaceFilesystemRecord = {
  key: string;
  filesystem: WorkspaceFilesystem;
};

type WorkspaceSurfaceStateRecord = {
  key: string;
  value: WorkspaceSurfaceState;
};

type WorkspaceMetadataRecord = {
  key: string;
  value: WorkspaceRegistry;
};

export type WorkspaceArtifactWriteInput = {
  file: LocalWorkspaceFile;
  source: WorkspaceFileNode["source"];
  bucket: WorkspaceArtifactBucket;
  producer_key?: string;
  producer_label?: string;
  created_at?: string;
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
      for (const storeName of Array.from(database.objectStoreNames)) {
        database.deleteObjectStore(storeName);
      }
      database.createObjectStore(FILESYSTEM_STORE, { keyPath: "key" });
      database.createObjectStore(SURFACE_STATE_STORE, { keyPath: "key" });
      database.createObjectStore(METADATA_STORE, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open the workspace database."));
  });

  return databasePromise;
}

function workspaceFilesystemKey(userId: string, workspaceId: string): string {
  return `filesystem:${userId}:${workspaceId}`;
}

function surfaceStateKey(userId: string, workspaceId: string, surfaceKey: string): string {
  return `surface:${userId}:${workspaceId}:${surfaceKey}`;
}

function workspaceRegistryKey(userId: string): string {
  return `registry:${userId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function bucketOrder(bucket: WorkspaceArtifactBucket): number {
  switch (bucket) {
    case "uploaded":
      return 0;
    case "data":
      return 1;
    case "chart":
      return 2;
    case "pdf":
      return 3;
  }
}

function defaultWorkspaceDescriptors(): WorkspaceDescriptor[] {
  return [
    {
      id: DEFAULT_WORKSPACE_ID,
      name: "Default workspace",
      kind: "default",
      created_at: nowIso(),
    },
    {
      id: DEMO_WORKSPACE_ID,
      name: "Demo workspace",
      kind: "demo",
      created_at: nowIso(),
    },
  ];
}

function normalizeWorkspaceDescriptor(
  descriptor: WorkspaceDescriptor,
): WorkspaceDescriptor {
  return {
    id: descriptor.id.trim() || crypto.randomUUID(),
    name: descriptor.name.trim() || "Untitled workspace",
    kind: descriptor.kind,
    created_at: descriptor.created_at || nowIso(),
  };
}

function normalizeWorkspaceRegistry(
  registry: WorkspaceRegistry | null | undefined,
): WorkspaceRegistry {
  const descriptors = registry?.workspaces ?? [];
  const normalizedById = new Map<string, WorkspaceDescriptor>();

  for (const builtin of defaultWorkspaceDescriptors()) {
    const existing = descriptors.find((descriptor) => descriptor.id === builtin.id);
    normalizedById.set(
      builtin.id,
      existing
        ? normalizeWorkspaceDescriptor({
            ...existing,
            kind: builtin.kind,
            name: existing.name.trim() || builtin.name,
          })
        : builtin,
    );
  }

  for (const descriptor of descriptors) {
    if (!descriptor.id || normalizedById.has(descriptor.id)) {
      continue;
    }
    normalizedById.set(descriptor.id, normalizeWorkspaceDescriptor(descriptor));
  }

  const workspaces = Array.from(normalizedById.values());
  const selectedWorkspaceId =
    registry?.selected_workspace_id && normalizedById.has(registry.selected_workspace_id)
      ? registry.selected_workspace_id
      : DEFAULT_WORKSPACE_ID;

  return {
    version: WORKSPACE_REGISTRY_VERSION,
    selected_workspace_id: selectedWorkspaceId,
    workspaces,
  };
}

function compareWorkspaceItems(left: WorkspaceItem, right: WorkspaceItem): number {
  return (
    bucketOrder(left.bucket) - bucketOrder(right.bucket) ||
    left.producer_label.localeCompare(right.producer_label) ||
    left.name.localeCompare(right.name) ||
    right.created_at.localeCompare(left.created_at)
  );
}

function renameWorkspaceFile(file: LocalWorkspaceFile, name: string): LocalWorkspaceFile {
  return {
    ...file,
    name,
    extension: getFileExtension(name),
  };
}

function normalizeProducer(
  source: WorkspaceFileNode["source"],
  bucket: WorkspaceArtifactBucket,
  producerKey?: string,
  producerLabel?: string,
): { producer_key: string; producer_label: string } {
  if (producerKey?.trim() && producerLabel?.trim()) {
    return {
      producer_key: producerKey.trim(),
      producer_label: producerLabel.trim(),
    };
  }

  if (source === "uploaded" || bucket === "uploaded") {
    return {
      producer_key: "uploaded",
      producer_label: "Uploaded",
    };
  }

  return {
    producer_key: producerKey?.trim() || "workspace",
    producer_label: producerLabel?.trim() || "Workspace",
  };
}

function normalizeWorkspaceFileNode(
  input: WorkspaceArtifactWriteInput,
): WorkspaceFileNode {
  const normalizedName = input.file.name.trim() || "untitled";
  const producer = normalizeProducer(
    input.source,
    input.bucket,
    input.producer_key,
    input.producer_label,
  );

  return {
    id: input.file.id,
    kind: "file",
    name: normalizedName,
    bucket: input.bucket,
    producer_key: producer.producer_key,
    producer_label: producer.producer_label,
    created_at: input.created_at ?? nowIso(),
    source: input.source,
    file: renameWorkspaceFile(input.file, normalizedName),
  };
}

function normalizeStructuredState<T extends object>(value: T | null | undefined): T | null {
  return value ?? null;
}

function normalizeFilesystem(filesystem: WorkspaceFilesystem | null | undefined): WorkspaceFilesystem {
  const artifactsById: Record<string, WorkspaceFileNode> = {};

  for (const rawNode of Object.values(filesystem?.artifacts_by_id ?? {})) {
    if (!rawNode || rawNode.kind !== "file" || !rawNode.file) {
      continue;
    }
    artifactsById[rawNode.file.id] = normalizeWorkspaceFileNode({
      file: rawNode.file,
      source: rawNode.source,
      bucket: rawNode.bucket,
      producer_key: rawNode.producer_key,
      producer_label: rawNode.producer_label,
      created_at: rawNode.created_at,
    });
  }

  return {
    version: "v1",
    artifacts_by_id: artifactsById,
    app_state: normalizeStructuredState<WorkspaceAppStateV1>(filesystem?.app_state),
    report_index: normalizeStructuredState<WorkspaceReportIndexV1>(filesystem?.report_index),
    reports_by_id: { ...(filesystem?.reports_by_id ?? {}) },
    tool_catalog: normalizeStructuredState<WorkspaceToolCatalogV1>(filesystem?.tool_catalog),
    workspace_index: normalizeStructuredState<WorkspaceIndexV1>(filesystem?.workspace_index),
    pdf_smart_splits: normalizeStructuredState<WorkspacePdfSmartSplitRegistryV1>(
      filesystem?.pdf_smart_splits,
    ),
    agents_markdown: filesystem?.agents_markdown ?? null,
  };
}

function normalizeSurfaceState(value: WorkspaceSurfaceState): WorkspaceSurfaceState {
  return {
    surface_key: value.surface_key,
    active_tab:
      typeof value.active_tab === "string" && value.active_tab.trim()
        ? value.active_tab.trim()
        : null,
  };
}

function ensureUniqueName(
  filesystem: WorkspaceFilesystem,
  bucket: WorkspaceArtifactBucket,
  requestedName: string,
): string {
  const normalizedName = requestedName.trim() || "untitled";
  const existingNames = new Set(
    Object.values(filesystem.artifacts_by_id)
      .filter((artifact) => artifact.bucket === bucket)
      .map((artifact) => artifact.file.name),
  );

  if (!existingNames.has(normalizedName)) {
    return normalizedName;
  }

  const dotIndex = normalizedName.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < normalizedName.length - 1;
  const stem = hasExtension ? normalizedName.slice(0, dotIndex) : normalizedName;
  const extension = hasExtension ? normalizedName.slice(dotIndex) : "";
  let counter = 2;

  while (true) {
    const candidate = `${stem} (${counter})${extension}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

function writeArtifacts(
  filesystem: WorkspaceFilesystem,
  artifacts: WorkspaceArtifactWriteInput[],
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  const nextFilesystem = normalizeFilesystem(filesystem);
  const storedFiles: LocalWorkspaceFile[] = [];

  for (const artifact of artifacts) {
    const dedupedName = ensureUniqueName(nextFilesystem, artifact.bucket, artifact.file.name);
    const nextNode = normalizeWorkspaceFileNode({
      ...artifact,
      file: renameWorkspaceFile(artifact.file, dedupedName),
    });
    nextFilesystem.artifacts_by_id[nextNode.id] = nextNode;
    storedFiles.push(nextNode.file);
  }

  return {
    filesystem: nextFilesystem,
    files: storedFiles,
  };
}

function inferBucket(
  file: LocalWorkspaceFile,
  source: WorkspaceFileNode["source"],
  bucket?: WorkspaceArtifactBucket,
): WorkspaceArtifactBucket {
  if (bucket) {
    return bucket;
  }
  if (source === "uploaded" || source === "demo") {
    return "uploaded";
  }
  if (file.kind === "pdf") {
    return "pdf";
  }
  return "data";
}

export function createWorkspaceFilesystem(): WorkspaceFilesystem {
  return {
    version: "v1",
    artifacts_by_id: {},
    app_state: null,
    report_index: null,
    reports_by_id: {},
    tool_catalog: null,
    workspace_index: null,
    pdf_smart_splits: null,
    agents_markdown: null,
  };
}

export function createWorkspaceDescriptor(
  name: string,
  kind: WorkspaceKind = "user",
): WorkspaceDescriptor {
  const trimmedName = name.trim();
  return {
    id: kind === "default" ? DEFAULT_WORKSPACE_ID : kind === "demo" ? DEMO_WORKSPACE_ID : crypto.randomUUID(),
    name:
      trimmedName ||
      (kind === "default" ? "Default workspace" : kind === "demo" ? "Demo workspace" : "Untitled workspace"),
    kind,
    created_at: nowIso(),
  };
}

export function createWorkspaceRegistry(): WorkspaceRegistry {
  return normalizeWorkspaceRegistry(null);
}

export async function loadWorkspaceRegistry(userId: string): Promise<WorkspaceRegistry> {
  try {
    const database = await openDatabase();
    return await new Promise<WorkspaceRegistry>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.get(workspaceRegistryKey(userId));

      request.onsuccess = () => {
        const record = request.result as WorkspaceMetadataRecord | undefined;
        resolve(normalizeWorkspaceRegistry(record?.value));
      };
      request.onerror = () => reject(request.error ?? new Error("Workspace registry read failed."));
    });
  } catch {
    return createWorkspaceRegistry();
  }
}

export async function saveWorkspaceRegistry(userId: string, registry: WorkspaceRegistry): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace registry write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace registry write failed."));

    store.put({
      key: workspaceRegistryKey(userId),
      value: normalizeWorkspaceRegistry(registry),
    } satisfies WorkspaceMetadataRecord);
  });
}

export async function loadWorkspaceFilesystem(
  userId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<WorkspaceFilesystem> {
  try {
    const database = await openDatabase();
    return await new Promise<WorkspaceFilesystem>((resolve, reject) => {
      const transaction = database.transaction(FILESYSTEM_STORE, "readonly");
      const store = transaction.objectStore(FILESYSTEM_STORE);
      const request = store.get(workspaceFilesystemKey(userId, workspaceId));

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

export async function saveWorkspaceFilesystem(
  userId: string,
  workspaceIdOrFilesystem: string | WorkspaceFilesystem,
  filesystemArg?: WorkspaceFilesystem,
): Promise<void> {
  const workspaceId =
    typeof workspaceIdOrFilesystem === "string" ? workspaceIdOrFilesystem : DEFAULT_WORKSPACE_ID;
  const filesystem =
    typeof workspaceIdOrFilesystem === "string"
      ? (filesystemArg ?? createWorkspaceFilesystem())
      : workspaceIdOrFilesystem;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FILESYSTEM_STORE, "readwrite");
    const store = transaction.objectStore(FILESYSTEM_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace filesystem write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace filesystem write failed."));

    store.put({
      key: workspaceFilesystemKey(userId, workspaceId),
      filesystem: normalizeFilesystem(filesystem),
    } satisfies WorkspaceFilesystemRecord);
  });
}

export async function loadWorkspaceSurfaceState(
  userId: string,
  workspaceId: string,
  surfaceKey: string,
): Promise<WorkspaceSurfaceState | null> {
  try {
    const database = await openDatabase();
    return await new Promise<WorkspaceSurfaceState | null>((resolve, reject) => {
      const transaction = database.transaction(SURFACE_STATE_STORE, "readonly");
      const store = transaction.objectStore(SURFACE_STATE_STORE);
      const request = store.get(surfaceStateKey(userId, workspaceId, surfaceKey));

      request.onsuccess = () => {
        const record = request.result as WorkspaceSurfaceStateRecord | undefined;
        resolve(record?.value ? normalizeSurfaceState(record.value) : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Workspace surface-state read failed."));
    });
  } catch {
    return null;
  }
}

export async function saveWorkspaceSurfaceState(
  userId: string,
  workspaceIdOrState: string | WorkspaceSurfaceState,
  stateArg?: WorkspaceSurfaceState,
): Promise<void> {
  const workspaceId =
    typeof workspaceIdOrState === "string" ? workspaceIdOrState : DEFAULT_WORKSPACE_ID;
  const state = typeof workspaceIdOrState === "string" ? stateArg : workspaceIdOrState;
  if (!state) {
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SURFACE_STATE_STORE, "readwrite");
    const store = transaction.objectStore(SURFACE_STATE_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Workspace surface-state write aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Workspace surface-state write failed."));

    store.put({
      key: surfaceStateKey(userId, workspaceId, state.surface_key),
      value: normalizeSurfaceState(state),
    } satisfies WorkspaceSurfaceStateRecord);
  });
}

export function getWorkspaceContext(
  filesystem: WorkspaceFilesystem,
  workspaceId: string,
): WorkspaceContext {
  return {
    workspace_id: workspaceId,
    referenced_item_ids: listAllWorkspaceFileNodes(filesystem).map((entry) => entry.id),
  };
}

export function listAllWorkspaceFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return Object.values(normalizeFilesystem(filesystem).artifacts_by_id).sort(compareWorkspaceItems);
}

export function listAllWorkspaceFiles(filesystem: WorkspaceFilesystem): LocalWorkspaceFile[] {
  return listAllWorkspaceFileNodes(filesystem).map((node) => node.file);
}

export function addWorkspaceFiles(
  filesystem: WorkspaceFilesystem,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
  options: {
    bucket?: WorkspaceArtifactBucket;
    producer_key?: string;
    producer_label?: string;
  } = {},
): WorkspaceFilesystem {
  return addWorkspaceFilesWithResult(filesystem, files, source, options).filesystem;
}

export function addWorkspaceFilesWithResult(
  filesystem: WorkspaceFilesystem,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
  options: {
    bucket?: WorkspaceArtifactBucket;
    producer_key?: string;
    producer_label?: string;
  } = {},
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  if (!files.length) {
    return { filesystem: normalizeFilesystem(filesystem), files: [] };
  }

  return writeArtifacts(
    filesystem,
    files.map((file) => ({
      file,
      source,
      bucket: inferBucket(file, source, options.bucket),
      producer_key: options.producer_key,
      producer_label: options.producer_label,
    })),
  );
}

export function addWorkspaceArtifactsWithResult(
  filesystem: WorkspaceFilesystem,
  artifacts: WorkspaceArtifactWriteInput[],
): { filesystem: WorkspaceFilesystem; files: LocalWorkspaceFile[] } {
  if (!artifacts.length) {
    return { filesystem: normalizeFilesystem(filesystem), files: [] };
  }
  return writeArtifacts(filesystem, artifacts);
}

export function replaceWorkspaceFiles(
  filesystem: WorkspaceFilesystem,
  files: LocalWorkspaceFile[],
  source: WorkspaceFileNode["source"],
  options: {
    bucket?: WorkspaceArtifactBucket;
    producer_key?: string;
    producer_label?: string;
  } = {},
): WorkspaceFilesystem {
  let nextFilesystem = createWorkspaceFilesystem();
  nextFilesystem = {
    ...nextFilesystem,
    app_state: normalizeFilesystem(filesystem).app_state,
    report_index: normalizeFilesystem(filesystem).report_index,
    reports_by_id: { ...normalizeFilesystem(filesystem).reports_by_id },
    tool_catalog: normalizeFilesystem(filesystem).tool_catalog,
    workspace_index: normalizeFilesystem(filesystem).workspace_index,
    pdf_smart_splits: normalizeFilesystem(filesystem).pdf_smart_splits,
    agents_markdown: normalizeFilesystem(filesystem).agents_markdown,
  };
  return addWorkspaceFiles(nextFilesystem, files, source, options);
}

export function removeWorkspaceEntry(filesystem: WorkspaceFilesystem, entryId: string): WorkspaceFilesystem {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  return {
    ...normalizedFilesystem,
    artifacts_by_id: Object.fromEntries(
      Object.entries(normalizedFilesystem.artifacts_by_id).filter(([artifactId]) => artifactId !== entryId),
    ),
  };
}

export function findWorkspaceFileNodeById(filesystem: WorkspaceFilesystem, fileId: string): WorkspaceFileNode | null {
  const normalizedFilesystem = normalizeFilesystem(filesystem);
  return normalizedFilesystem.artifacts_by_id[fileId] ?? null;
}

export function summarizeWorkspaceFile(fileNode: WorkspaceFileNode): Record<string, unknown> {
  const file = fileNode.file;
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    extension: file.extension,
    byte_size: file.byte_size,
    mime_type: file.mime_type,
    bucket: fileNode.bucket,
    producer_key: fileNode.producer_key,
    producer_label: fileNode.producer_label,
    source: fileNode.source,
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
