import type { LocalWorkspaceFile } from "./report";
import type {
  WorkspaceAppStateV1,
  WorkspaceArtifactBucket,
  WorkspaceIndexV1,
  WorkspacePdfSmartSplitRegistryV1,
  WorkspaceReportIndexV1,
  WorkspaceReportV1,
  WorkspaceToolCatalogV1,
} from "./workspace-contract";

export type WorkspaceKind = "default" | "demo" | "user";

export type WorkspaceContext = {
  workspace_id: string;
  referenced_item_ids: string[];
};

export type WorkspaceFileNode = {
  id: string;
  kind: "file";
  name: string;
  bucket: WorkspaceArtifactBucket;
  producer_key: string;
  producer_label: string;
  created_at: string;
  source: "uploaded" | "derived" | "demo";
  file: LocalWorkspaceFile;
};

export type WorkspaceItem = WorkspaceFileNode;

export type WorkspaceFilesystem = {
  version: "v1";
  artifacts_by_id: Record<string, WorkspaceFileNode>;
  app_state: WorkspaceAppStateV1 | null;
  report_index: WorkspaceReportIndexV1 | null;
  reports_by_id: Record<string, WorkspaceReportV1>;
  tool_catalog: WorkspaceToolCatalogV1 | null;
  workspace_index: WorkspaceIndexV1 | null;
  pdf_smart_splits: WorkspacePdfSmartSplitRegistryV1 | null;
  agents_markdown: string | null;
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
  active_tab: string | null;
};
