import { apiRequest } from "./api";
import type {
  ApplyWorkspaceItemOperationPayload,
  DeleteWorkspaceUploadResponse,
  WorkspaceCreatedItemDetail,
  WorkspaceAppId,
  WorkspaceCreatePayload,
  WorkspaceItemCreatePayload,
  WorkspaceItemRevision,
  WorkspaceListItem,
  WorkspaceState,
  WorkspaceUpdatePayload,
  WorkspaceUploadCreatePayload,
  WorkspaceUploadItemSummary,
} from "../types/workspace";

export class WorkspaceApiClient {
  listWorkspaces(appId: WorkspaceAppId): Promise<WorkspaceListItem[]> {
    return apiRequest<WorkspaceListItem[]>(`/workspaces?app_id=${appId}`);
  }

  createWorkspace(payload: WorkspaceCreatePayload): Promise<WorkspaceState> {
    return apiRequest<WorkspaceState>("/workspaces", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getWorkspace(workspaceId: string, appId: WorkspaceAppId): Promise<WorkspaceState> {
    return apiRequest<WorkspaceState>(`/workspaces/${workspaceId}?app_id=${appId}`);
  }

  patchWorkspace(
    workspaceId: string,
    appId: WorkspaceAppId,
    payload: WorkspaceUpdatePayload,
  ): Promise<WorkspaceState> {
    return apiRequest<WorkspaceState>(`/workspaces/${workspaceId}?app_id=${appId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  createUpload(
    workspaceId: string,
    payload: WorkspaceUploadCreatePayload,
  ): Promise<WorkspaceUploadItemSummary> {
    return apiRequest<WorkspaceUploadItemSummary>(`/workspaces/${workspaceId}/uploads`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  deleteUpload(
    workspaceId: string,
    itemId: string,
  ): Promise<DeleteWorkspaceUploadResponse> {
    return apiRequest<DeleteWorkspaceUploadResponse>(
      `/workspaces/${workspaceId}/uploads/${itemId}`,
      {
        method: "DELETE",
      },
    );
  }

  createItem(
    workspaceId: string,
    payload: WorkspaceItemCreatePayload,
  ): Promise<WorkspaceCreatedItemDetail> {
    return apiRequest<WorkspaceCreatedItemDetail>(`/workspaces/${workspaceId}/items`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getItem(
    workspaceId: string,
    itemId: string,
  ): Promise<WorkspaceCreatedItemDetail> {
    return apiRequest<WorkspaceCreatedItemDetail>(`/workspaces/${workspaceId}/items/${itemId}`);
  }

  listItemRevisions(
    workspaceId: string,
    itemId: string,
  ): Promise<WorkspaceItemRevision[]> {
    return apiRequest<WorkspaceItemRevision[]>(`/workspaces/${workspaceId}/items/${itemId}/revisions`);
  }

  applyItemOperation(
    workspaceId: string,
    itemId: string,
    payload: ApplyWorkspaceItemOperationPayload,
  ): Promise<WorkspaceCreatedItemDetail> {
    return apiRequest<WorkspaceCreatedItemDetail>(
      `/workspaces/${workspaceId}/items/${itemId}/operations`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }
}
