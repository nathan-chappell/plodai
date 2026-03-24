import { buildWorkspaceFilePayload } from "./workspace-artifacts";
import { WorkspaceApiClient } from "./workspace-api";
import { WorkspaceFileStore } from "./workspace-file-store";
import type { LocalAttachment } from "../types/report";
import type {
  ApplyWorkspaceItemOperationPayload,
  WorkspaceAppId,
  WorkspaceCreatedItemDetail,
  WorkspaceItemCreatePayload,
  WorkspaceItemRevision,
  WorkspaceListItem,
  WorkspaceResolvedLocalAttachment,
  WorkspaceState,
  WorkspaceUpdatePayload,
  WorkspaceUploadCreatePayload,
  WorkspaceUploadItemSummary,
} from "../types/workspace";

function buildUploadPreview(file: LocalAttachment): WorkspaceUploadCreatePayload["preview"] {
  if (file.kind === "csv" || file.kind === "json") {
    return {
      row_count: file.row_count,
      columns: file.columns,
      numeric_columns: file.numeric_columns,
      sample_rows: file.sample_rows,
    };
  }
  if (file.kind === "pdf") {
    return {
      page_count: file.page_count,
    };
  }
  if (file.kind === "image") {
    return {
      width: file.width,
      height: file.height,
    };
  }
  return {};
}

function isUploadItem(item: WorkspaceState["items"][number]): item is WorkspaceUploadItemSummary {
  return item.origin === "upload";
}

async function bytesForLocalAttachment(file: LocalAttachment): Promise<Uint8Array> {
  const payload = buildWorkspaceFilePayload(file);
  return new Uint8Array(await payload.blob.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return `fallback:${bytes.length}`;
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeWorkspaceContentKey(file: LocalAttachment): Promise<string> {
  const bytes = await bytesForLocalAttachment(file);
  return `sha256:${await sha256Hex(bytes)}`;
}

export class WorkspaceRepository {
  private readonly apiClient: WorkspaceApiClient;
  private readonly attachmentStore: WorkspaceFileStore;

  constructor(
    apiClient = new WorkspaceApiClient(),
    attachmentStore = new WorkspaceFileStore(),
  ) {
    this.apiClient = apiClient;
    this.attachmentStore = attachmentStore;
  }

  async listWorkspaces(appId: WorkspaceAppId): Promise<WorkspaceListItem[]> {
    return this.apiClient.listWorkspaces(appId);
  }

  async ensureWorkspace(appId: WorkspaceAppId): Promise<WorkspaceState> {
    const workspaces = await this.apiClient.listWorkspaces(appId);
    if (workspaces.length) {
      return this.loadWorkspace(workspaces[0].id, appId);
    }
    return this.apiClient.createWorkspace({
      app_id: appId,
      name: appId === "agriculture" ? "Farm" : "Documents",
    });
  }

  async createWorkspace(
    name: string,
    appId: WorkspaceAppId,
  ): Promise<WorkspaceState> {
    const state = await this.apiClient.createWorkspace({
      app_id: appId,
      name,
    });
    return this.overlayWorkspaceState(state);
  }

  async loadWorkspace(
    workspaceId: string,
    appId: WorkspaceAppId,
  ): Promise<WorkspaceState> {
    const state = await this.apiClient.getWorkspace(workspaceId, appId);
    return this.overlayWorkspaceState(state);
  }

  async updateWorkspace(
    workspaceId: string,
    appId: WorkspaceAppId,
    payload: WorkspaceUpdatePayload,
  ): Promise<WorkspaceState> {
    const state = await this.apiClient.patchWorkspace(workspaceId, appId, payload);
    return this.overlayWorkspaceState(state);
  }

  async createUpload(
    workspaceId: string,
    file: LocalAttachment,
    options?: {
      sourceItemId?: string | null;
    },
  ): Promise<WorkspaceUploadItemSummary> {
    const contentKey = await computeWorkspaceContentKey(file);
    await this.attachmentStore.put(contentKey, file);
    const entry = await this.apiClient.createUpload(workspaceId, {
      id: file.id,
      name: file.name,
      kind: file.kind,
      extension: file.extension,
      mime_type: file.mime_type ?? null,
      byte_size: file.byte_size ?? null,
      content_key: contentKey,
      local_status: "available",
      preview: buildUploadPreview(file),
      source_item_id: options?.sourceItemId ?? null,
    });
    return {
      ...entry,
      local_status: "available",
    };
  }

  async deleteUpload(workspaceId: string, itemId: string): Promise<void> {
    await this.apiClient.deleteUpload(workspaceId, itemId);
  }

  async resolveLocalAttachment(entry: WorkspaceUploadItemSummary): Promise<LocalAttachment | null> {
    return this.attachmentStore.get(entry.content_key);
  }

  async resolveWorkspaceUpload(entry: WorkspaceUploadItemSummary): Promise<WorkspaceResolvedLocalAttachment> {
    return {
      entry,
      file: await this.resolveLocalAttachment(entry),
    };
  }

  async createItem(
    workspaceId: string,
    payload: WorkspaceItemCreatePayload,
  ): Promise<WorkspaceCreatedItemDetail> {
    return this.apiClient.createItem(workspaceId, payload);
  }

  async getItem(
    workspaceId: string,
    itemId: string,
  ): Promise<WorkspaceCreatedItemDetail> {
    return this.apiClient.getItem(workspaceId, itemId);
  }

  async deleteItem(workspaceId: string, itemId: string): Promise<void> {
    await this.apiClient.deleteItem(workspaceId, itemId);
  }

  async listItemRevisions(
    workspaceId: string,
    itemId: string,
  ): Promise<WorkspaceItemRevision[]> {
    return this.apiClient.listItemRevisions(workspaceId, itemId);
  }

  async applyItemOperation(
    workspaceId: string,
    itemId: string,
    payload: ApplyWorkspaceItemOperationPayload,
  ): Promise<WorkspaceCreatedItemDetail> {
    return this.apiClient.applyItemOperation(workspaceId, itemId, payload);
  }

  async overlayWorkspaceState(state: WorkspaceState): Promise<WorkspaceState> {
    const uploadItems = state.items.filter(isUploadItem);
    const localStatuses = await Promise.all(
      uploadItems.map(async (item) => ({
        id: item.id,
        local_status: ((await this.attachmentStore.has(item.content_key))
          ? "available"
          : "missing") as WorkspaceUploadItemSummary["local_status"],
      })),
    );
    const byId = new Map(localStatuses.map((item) => [item.id, item.local_status]));
    return {
      ...state,
      items: state.items.map((item) =>
        item.origin === "upload"
          ? {
              ...item,
              local_status: byId.get(item.id) ?? "missing",
            }
          : item,
      ),
    };
  }
}
