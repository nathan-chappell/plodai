import type { ClientEffect, ClientToolArgsMap, ClientToolName } from "./analysis";
import type { LocalWorkspaceFile } from "./report";
import type { WorkspaceContext, WorkspaceFilesystem } from "./workspace";
import type {
  ReportSlideV1,
  WorkspaceBootstrapMetadata,
  WorkspaceReportV1,
} from "./workspace-contract";

export type WorkspaceSnapshotV1 = {
  version: "v1";
  filesystem: WorkspaceFilesystem;
  path_prefix: string;
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

export type UpsertWorkspaceFilesMutationV1 = {
  type: "upsert_workspace_files";
  files: Array<{
    path: string;
    file: LocalWorkspaceFile;
    source: "derived" | "demo";
  }>;
};

export type ReplaceReportSlidesMutationV1 = {
  type: "replace_report_slides";
  report_id: string;
  slides: ReportSlideV1[];
};

export type UpsertReportMutationV1 = {
  type: "upsert_report";
  report: WorkspaceReportV1;
};

export type UpdateReportIndexMutationV1 = {
  type: "update_report_index";
  report_ids: string[];
  current_report_id: string | null;
};

export type AppendReportSlidesMutationV1 = {
  type: "append_report_slides";
  report_id: string;
  slides: ReportSlideV1[];
};

export type UpdateAppStateMutationV1 = {
  type: "update_app_state";
  patch: Record<string, unknown>;
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
  | UpsertWorkspaceFilesMutationV1
  | UpsertReportMutationV1
  | UpdateReportIndexMutationV1
  | ReplaceReportSlidesMutationV1
  | AppendReportSlidesMutationV1
  | UpdateAppStateMutationV1
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
