import type { ClientEffect, ClientToolArgsMap, ClientToolName } from "./analysis";
import type { LocalWorkspaceFile } from "./report";
import type { WorkspaceContext, WorkspaceFilesystem } from "./workspace";
import type { ReportItemV1, WorkspaceBootstrapMetadata } from "./workspace-contract";

export type WorkspaceSnapshotV1 = {
  version: "v1";
  filesystem: WorkspaceFilesystem;
  cwd_path: string;
  workspace_context: WorkspaceContext;
  bootstrap: WorkspaceBootstrapMetadata;
};

export type WriteTextFileMutationV1 = {
  type: "write_text_file";
  path: string;
  text: string;
  source: "derived" | "demo";
};

export type DeletePathMutationV1 = {
  type: "delete_path";
  path: string;
};

export type MkdirMutationV1 = {
  type: "mkdir";
  path: string;
};

export type AppendWorkspaceFilesMutationV1 = {
  type: "append_workspace_files";
  directory_path: string;
  files: LocalWorkspaceFile[];
  source: "derived" | "demo";
};

export type ReplaceReportItemsMutationV1 = {
  type: "replace_report_items";
  report_id: string;
  items: ReportItemV1[];
};

export type AppendReportItemsMutationV1 = {
  type: "append_report_items";
  report_id: string;
  items: ReportItemV1[];
};

export type UpdateAppStateMutationV1 = {
  type: "update_app_state";
  patch: Record<string, unknown>;
};

export type ChangeDirectoryMutationV1 = {
  type: "change_directory";
  path: string;
};

export type RenderChartArtifactMutationV1 = {
  type: "render_chart_artifact";
  chart_plan_id: string;
  file_id: string;
  title: string;
  chart: Record<string, unknown>;
  artifact_path: string;
};

export type VfsMutationV1 =
  | WriteTextFileMutationV1
  | DeletePathMutationV1
  | MkdirMutationV1
  | AppendWorkspaceFilesMutationV1
  | ReplaceReportItemsMutationV1
  | AppendReportItemsMutationV1
  | UpdateAppStateMutationV1
  | ChangeDirectoryMutationV1
  | RenderChartArtifactMutationV1;

export type ToolExecutionRequestV1<
  Name extends ClientToolName = ClientToolName,
> = {
  version: "v1";
  request_id: number;
  tool_name: Name;
  arguments: ClientToolArgsMap[Name];
  snapshot: WorkspaceSnapshotV1;
};

export type ToolExecutionResultV1 = {
  version: "v1";
  request_id: number;
  tool_name: ClientToolName;
  payload: Record<string, unknown>;
  mutations: VfsMutationV1[];
  effects: ClientEffect[];
  warnings: string[];
};
