export type AdvisorySeverity = "low" | "medium" | "high";
export type AdvisorySubjectKind =
  | "crop"
  | "livestock"
  | "parcel"
  | "equipment"
  | "infrastructure"
  | "market"
  | "administrative"
  | "other";
export type AdvisorySubjectStatus = "planned" | "active" | "inactive" | "resolved";
export type AdvisoryReportCategory =
  | "pest"
  | "disease"
  | "weather_damage"
  | "drought"
  | "flood"
  | "input_shortage"
  | "market_bottleneck"
  | "infrastructure_damage"
  | "livestock_health"
  | "subsidy_or_payment"
  | "invasive_species"
  | "other";
export type AdvisoryReportStatus = "open" | "monitoring" | "resolved" | "escalated";
export type AdvisoryQueryCategory =
  | "production"
  | "plant_health"
  | "livestock_health"
  | "input_sourcing"
  | "regulatory"
  | "subsidy"
  | "market"
  | "weather"
  | "other";
export type AdvisoryQueryStatus = "open" | "answered" | "needs_follow_up";
export type AdvisoryMaterialStatus = "to_check" | "available" | "not_available" | "ordered";

export type AdvisorySubject = {
  id: string;
  name: string;
  kind: AdvisorySubjectKind;
  type?: string | null;
  location?: string | null;
  description?: string | null;
  quantity?: string | null;
  status?: AdvisorySubjectStatus | null;
  notes?: string | null;
};

export type AdvisoryMeasurement = {
  id: string;
  label: string;
  value: string;
  unit?: string | null;
  measured_at?: string | null;
  method?: string | null;
  location?: string | null;
  subject_ids: string[];
  report_ids: string[];
  query_ids: string[];
  notes?: string | null;
};

export type AdvisoryReport = {
  id: string;
  category: AdvisoryReportCategory;
  title: string;
  description?: string | null;
  status?: AdvisoryReportStatus | null;
  severity?: AdvisorySeverity | null;
  reported_at?: string | null;
  observed_at?: string | null;
  location?: string | null;
  recommended_follow_up?: string | null;
  subject_ids: string[];
  evidence_image_ids: string[];
  measurement_ids: string[];
};

export type AdvisoryQuery = {
  id: string;
  category: AdvisoryQueryCategory;
  question: string;
  status: AdvisoryQueryStatus;
  asked_at?: string | null;
  answer_summary?: string | null;
  source_urls: string[];
  subject_ids: string[];
  report_ids: string[];
  measurement_ids: string[];
  notes?: string | null;
};

export type AdvisoryMaterial = {
  id: string;
  name: string;
  purpose?: string | null;
  category?: string | null;
  status: AdvisoryMaterialStatus;
  supplier_name?: string | null;
  supplier_url?: string | null;
  subject_ids: string[];
  report_ids: string[];
  query_ids: string[];
  notes?: string | null;
};

export type AdvisoryRecordPayload = {
  version: "v2";
  title: string;
  profile_description?: string | null;
  default_location?: string | null;
  subjects: AdvisorySubject[];
  reports: AdvisoryReport[];
  queries: AdvisoryQuery[];
  measurements: AdvisoryMeasurement[];
  materials: AdvisoryMaterial[];
};

export type AdvisoryImageSourceKind = "upload" | "chat_attachment";

export type AdvisoryImageSummary = {
  id: string;
  case_id: string;
  chat_id?: string | null;
  attachment_id?: string | null;
  source_kind: AdvisoryImageSourceKind;
  name: string;
  mime_type?: string | null;
  byte_size: number;
  width: number;
  height: number;
  preview_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type AdvisoryCaseSummary = {
  id: string;
  title: string;
  chat_id?: string | null;
  image_count: number;
  created_at: string;
  updated_at: string;
};

export type AdvisoryCaseDetail = AdvisoryCaseSummary & {
  default_location?: string | null;
  profile_description?: string | null;
  images: AdvisoryImageSummary[];
};

export type AdvisoryRecordResponse = {
  case_id: string;
  record: AdvisoryRecordPayload;
};

export type AdvisoryCaseDeleteResponse = {
  case_id: string;
  deleted: boolean;
};

export type AdvisoryImageUploadResponse = {
  image: AdvisoryImageSummary;
};

export type AdvisoryImageDeleteResponse = {
  case_id: string;
  image_id: string;
  deleted: boolean;
};
