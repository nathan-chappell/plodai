import type { ClientChartSpec } from "./analysis";
import type { LocalAttachment, LocalAttachmentKind } from "./report";
import type { ReportSlideV1, WorkspaceReportV1 } from "./workspace-contract";

export type WorkspaceAppId = "plodai" | "documents";
export type WorkspaceCreatedItemKind =
  | "report.v1"
  | "chart.v1"
  | "pdf_split.v1"
  | "farm.v1";
export type WorkspaceLocalStatus = "available" | "missing";

export type DatasetPreview = {
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: Array<Record<string, unknown>>;
};

export type PdfPreview = {
  page_count: number;
};

export type ImagePreview = {
  width: number;
  height: number;
};

export type EmptyPreview = Record<string, never>;

export type WorkspaceUploadPreview =
  | DatasetPreview
  | PdfPreview
  | ImagePreview
  | EmptyPreview;

export type WorkspaceUploadItemSummary = {
  origin: "upload";
  id: string;
  workspace_id: string;
  name: string;
  kind: LocalAttachmentKind;
  extension: string;
  mime_type?: string | null;
  byte_size?: number | null;
  content_key: string;
  local_status: WorkspaceLocalStatus;
  preview: WorkspaceUploadPreview;
  source_item_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChartItemPayloadV1 = {
  version: "v1";
  source_file_id: string;
  chart_plan_id: string;
  title: string;
  chart: ClientChartSpec | Record<string, unknown>;
  image_data_url?: string | null;
  linked_report_id?: string | null;
  projection_file_id?: string | null;
};

export type PdfSplitEntryV1 = {
  file_id: string;
  file_name: string;
  title: string;
  start_page: number;
  end_page: number;
  page_count: number;
};

export type PdfSplitItemPayloadV1 = {
  version: "v1";
  title: string;
  source_file_id: string;
  entries: PdfSplitEntryV1[];
  archive_file_id: string;
  index_file_id: string;
  markdown: string;
};

export type FarmCropV1 = {
  id: string;
  name: string;
  area: string;
  expected_yield?: string | null;
  notes?: string | null;
};

export type FarmOrderItemV1 = {
  id: string;
  label: string;
  quantity?: string | null;
  crop_id?: string | null;
  notes?: string | null;
};

export type FarmOrderStatusV1 = "draft" | "live" | "sold_out";

export type FarmOrderV1 = {
  id: string;
  title: string;
  status: FarmOrderStatusV1;
  summary?: string | null;
  price_label?: string | null;
  order_url?: string | null;
  items: FarmOrderItemV1[];
  hero_image_file_id?: string | null;
  hero_image_alt_text?: string | null;
  notes?: string | null;
};

export type FarmItemPayloadV1 = {
  version: "v1";
  farm_name: string;
  location?: string | null;
  crops: FarmCropV1[];
  orders?: FarmOrderV1[];
  notes?: string | null;
};

export type WorkspaceItemPayload =
  | WorkspaceReportV1
  | ChartItemPayloadV1
  | PdfSplitItemPayloadV1
  | FarmItemPayloadV1;

export type ReportItemSummaryData = {
  slide_count: number;
};

export type ChartItemSummaryData = {
  source_file_id: string;
  chart_plan_id: string;
  projection_file_id?: string | null;
};

export type PdfSplitItemSummaryData = {
  source_file_id: string;
  entry_count: number;
  archive_file_id: string;
  index_file_id: string;
};

export type FarmItemSummaryData = {
  crop_count: number;
  order_count?: number;
};

export type WorkspaceCreatedItemSummaryData =
  | ReportItemSummaryData
  | ChartItemSummaryData
  | PdfSplitItemSummaryData
  | FarmItemSummaryData;

export type WorkspaceCreatedItemSummary = {
  origin: "created";
  id: string;
  workspace_id: string;
  kind: WorkspaceCreatedItemKind;
  schema_version: "v1";
  title: string;
  current_revision: number;
  created_by_user_id: string;
  created_by_agent_id?: string | null;
  last_edited_by_agent_id?: string | null;
  summary: WorkspaceCreatedItemSummaryData;
  latest_op: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceCreatedItemDetail = WorkspaceCreatedItemSummary & {
  payload: WorkspaceItemPayload;
};

export type WorkspaceItemSummary =
  | WorkspaceUploadItemSummary
  | WorkspaceCreatedItemSummary;

export type WorkspaceItemDetail =
  | WorkspaceUploadItemSummary
  | WorkspaceCreatedItemDetail;

export type WorkspaceItemRevision = {
  item_id: string;
  revision: number;
  op: string;
  payload: WorkspaceItemPayload;
  summary: WorkspaceCreatedItemSummaryData;
  created_by_user_id: string;
  created_by_agent_id?: string | null;
  created_at: string;
};

export type WorkspaceState = {
  version: "v4";
  workspace_id: string;
  workspace_name: string;
  app_id: WorkspaceAppId;
  active_chat_id?: string | null;
  selected_item_id?: string | null;
  current_report_item_id?: string | null;
  items: WorkspaceItemSummary[];
};

export type WorkspaceListItem = {
  id: string;
  app_id: WorkspaceAppId;
  name: string;
  active_chat_id?: string | null;
  selected_item_id?: string | null;
  current_report_item_id?: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceCreatePayload = {
  app_id: WorkspaceAppId;
  name: string;
  active_chat_id?: string | null;
  selected_item_id?: string | null;
  current_report_item_id?: string | null;
};

export type WorkspaceUpdatePayload = {
  name?: string | null;
  active_chat_id?: string | null;
  selected_item_id?: string | null;
  current_report_item_id?: string | null;
};

export type WorkspaceUploadCreatePayload = {
  id: string;
  name: string;
  kind: LocalAttachmentKind;
  extension: string;
  mime_type?: string | null;
  byte_size?: number | null;
  content_key: string;
  local_status: WorkspaceLocalStatus;
  preview: WorkspaceUploadPreview;
  source_item_id?: string | null;
};

export type WorkspaceItemCreatePayload = {
  id: string;
  kind: WorkspaceCreatedItemKind;
  payload: WorkspaceItemPayload;
  created_by_agent_id?: string | null;
};

export type ReportSetTitleOperation = {
  op: "report.set_title";
  title: string;
};

export type ReportAppendSlideOperation = {
  op: "report.append_slide";
  slide: ReportSlideV1;
};

export type ReportReplaceSlideOperation = {
  op: "report.replace_slide";
  slide_id: string;
  slide: ReportSlideV1;
};

export type ReportRemoveSlideOperation = {
  op: "report.remove_slide";
  slide_id: string;
};

export type ChartSetSpecOperation = {
  op: "chart.set_spec";
  source_file_id: string;
  chart_plan_id: string;
  title: string;
  chart: ClientChartSpec | Record<string, unknown>;
  linked_report_id?: string | null;
  projection_file_id?: string | null;
};

export type ChartSetPreviewOperation = {
  op: "chart.set_preview";
  image_data_url?: string | null;
  projection_file_id?: string | null;
};

export type PdfSplitSetResultOperation = {
  op: "pdf_split.set_result";
  title: string;
  source_file_id: string;
  entries: PdfSplitEntryV1[];
  archive_file_id: string;
  index_file_id: string;
  markdown: string;
};

export type FarmSetStateOperation = {
  op: "farm.set_state";
  farm_name: string;
  location?: string | null;
  crops: FarmCropV1[];
  orders?: FarmOrderV1[] | null;
  notes?: string | null;
};

export type PublicFarmOrderResponse = {
  workspace_id: string;
  farm_name: string;
  location?: string | null;
  order: FarmOrderV1;
  hero_image_preview_url?: string | null;
};

export type WorkspaceItemOperation =
  | ReportSetTitleOperation
  | ReportAppendSlideOperation
  | ReportReplaceSlideOperation
  | ReportRemoveSlideOperation
  | ChartSetSpecOperation
  | ChartSetPreviewOperation
  | PdfSplitSetResultOperation
  | FarmSetStateOperation;

export type ApplyWorkspaceItemOperationPayload = {
  base_revision: number;
  operation: WorkspaceItemOperation;
  created_by_agent_id?: string | null;
};

export type DeleteWorkspaceUploadResponse = {
  workspace_id: string;
  item_id: string;
  deleted: boolean;
};

export type DeleteWorkspaceItemResponse = {
  workspace_id: string;
  item_id: string;
  deleted: boolean;
};

export type WorkspaceResolvedLocalAttachment = {
  entry: WorkspaceUploadItemSummary;
  file: LocalAttachment | null;
};
