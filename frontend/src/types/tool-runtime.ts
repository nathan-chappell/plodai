import type { PdfSmartSplitBundleView } from "../tools/types";
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
  workspace_id: string;
  producer_key: string;
  producer_label: string;
  filesystem: WorkspaceFilesystem;
  workspace_context: WorkspaceContext;
  bootstrap: WorkspaceBootstrapMetadata;
};

export type UpsertWorkspaceFilesMutationV1 = {
  type: "upsert_workspace_files";
  artifacts: Array<{
    file: LocalWorkspaceFile;
    source: "derived" | "demo";
    bucket: "uploaded" | "data" | "chart" | "pdf";
    producer_key: string;
    producer_label: string;
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
  artifact_filename: string;
  producer_key: string;
  producer_label: string;
};

export type UpsertPdfSmartSplitRegistryMutationV1 = {
  type: "upsert_pdf_smart_split_registry";
  bundles: PdfSmartSplitBundleView[];
};

export type VfsMutationV1 =
  | UpsertWorkspaceFilesMutationV1
  | UpsertPdfSmartSplitRegistryMutationV1
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
