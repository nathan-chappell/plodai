export type FarmWorkItemSeverity = "low" | "medium" | "high";
export type FarmCropStatus = "planned" | "active" | "harvested" | "inactive";
export type FarmWorkItemKind = "issue" | "task" | "observation";
export type FarmWorkItemStatus = "open" | "monitoring" | "resolved";

export type FarmArea = {
  id: string;
  name: string;
  kind?: string | null;
  description?: string | null;
};

export type FarmWorkItem = {
  id: string;
  kind: FarmWorkItemKind;
  title: string;
  description?: string | null;
  status?: FarmWorkItemStatus | null;
  severity?: FarmWorkItemSeverity | null;
  observed_at?: string | null;
  due_at?: string | null;
  recommended_follow_up?: string | null;
  related_crop_ids: string[];
  related_area_ids: string[];
  related_image_ids: string[];
};

export type FarmCrop = {
  id: string;
  name: string;
  type?: string | null;
  quantity?: string | null;
  expected_yield?: string | null;
  area_ids: string[];
  status?: FarmCropStatus | null;
  notes?: string | null;
};

export type FarmOrderItem = {
  id: string;
  label: string;
  quantity?: string | null;
  crop_id?: string | null;
  notes?: string | null;
};

export type FarmOrderStatus = "draft" | "live" | "sold_out";

export type FarmOrder = {
  id: string;
  title: string;
  status: FarmOrderStatus;
  summary?: string | null;
  price_label?: string | null;
  order_url?: string | null;
  items: FarmOrderItem[];
  hero_image_file_id?: string | null;
  hero_image_alt_text?: string | null;
  notes?: string | null;
};

export type FarmRecordPayload = {
  version: "v1";
  farm_name: string;
  description?: string | null;
  location?: string | null;
  areas: FarmArea[];
  crops: FarmCrop[];
  work_items: FarmWorkItem[];
  orders: FarmOrder[];
};

export type FarmImageSourceKind = "upload" | "chat_attachment";

export type FarmImageSummary = {
  id: string;
  farm_id: string;
  chat_id?: string | null;
  attachment_id?: string | null;
  source_kind: FarmImageSourceKind;
  name: string;
  mime_type?: string | null;
  byte_size: number;
  width: number;
  height: number;
  preview_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type FarmSummary = {
  id: string;
  name: string;
  chat_id?: string | null;
  image_count: number;
  created_at: string;
  updated_at: string;
};

export type FarmDetail = FarmSummary & {
  location?: string | null;
  description?: string | null;
  images: FarmImageSummary[];
};

export type FarmRecordResponse = {
  farm_id: string;
  record: FarmRecordPayload;
};

export type FarmDeleteResponse = {
  farm_id: string;
  deleted: boolean;
};

export type FarmImageUploadResponse = {
  image: FarmImageSummary;
};

export type FarmImageDeleteResponse = {
  farm_id: string;
  image_id: string;
  deleted: boolean;
};

export type PublicFarmOrderResponse = {
  farm_id: string;
  farm_name: string;
  location?: string | null;
  order: FarmOrder;
  hero_image_preview_url?: string | null;
};
