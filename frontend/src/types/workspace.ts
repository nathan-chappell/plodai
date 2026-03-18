import type { LocalWorkspaceFile } from "./report";

export type WorkspaceContext = {
  cwd_path: string;
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
  parent_id: string;
  created_at: string;
  source: "uploaded" | "derived" | "demo";
  file: LocalWorkspaceFile;
};

export type WorkspaceItem = WorkspaceDirectoryNode | WorkspaceFileNode;

export type WorkspaceFilesystem = {
  root_id: string;
  items: WorkspaceItem[];
};

export type WorkspaceSurfaceState = {
  surface_key: string;
  cwd_path: string;
};

export type WorkspaceBreadcrumb = {
  id: string;
  name: string;
  path: string;
};

