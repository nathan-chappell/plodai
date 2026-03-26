export type FarmCropIssueSeverity = "low" | "medium" | "high";

export type FarmCropIssue = {
  id: string;
  title: string;
  description?: string | null;
  severity: FarmCropIssueSeverity;
  deadline?: string | null;
  recommended_follow_up?: string | null;
};

export type FarmCrop = {
  id: string;
  name: string;
  type?: string | null;
  quantity?: string | null;
  expected_yield?: string | null;
  issues: FarmCropIssue[];
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
  crops: FarmCrop[];
  orders?: FarmOrder[];
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
