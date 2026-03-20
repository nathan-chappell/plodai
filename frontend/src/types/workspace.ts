import type { LocalWorkspaceFile } from "./report";

export type WorkspaceKind = "default" | "demo" | "user";

export type WorkspaceContext = {
  path_prefix: string;
  referenced_item_ids: string[];
};

export type WorkspaceDirectoryNode = {
  id: string;
  kind: "directory";
  name: string;
  path: string;
  parent_id: string | null;
  created_at: string;
};

export type WorkspaceFileNode = {
  id: string;
  kind: "file";
  name: string;
  path: string;
  created_at: string;
  source: "uploaded" | "derived" | "demo";
  file: LocalWorkspaceFile;
};

export type WorkspaceItem = WorkspaceFileNode;

export type WorkspaceFilesystem = {
  files_by_path: Record<string, WorkspaceFileNode>;
};

export type WorkspaceDescriptor = {
  id: string;
  name: string;
  kind: WorkspaceKind;
  created_at: string;
};

export type WorkspaceRegistry = {
  version: "v1";
  selected_workspace_id: string;
  workspaces: WorkspaceDescriptor[];
};

export type WorkspaceSurfaceState = {
  surface_key: string;
  active_prefix: string;
};

export type WorkspaceBreadcrumb = {
  id: string;
  name: string;
  prefix: string;
  path: string;
};
