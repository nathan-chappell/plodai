import type {
  CreditGrantRecord,
  ManualCreditGrantRequest,
  UserRole,
} from "../../../vendor/ai-portfolio-admin/frontend/types";

export type GrantCreditPayload = Pick<ManualCreditGrantRequest, "user_id" | "credit_amount_usd"> & {
  note?: string;
};

export type GrantCreditResponse = Pick<CreditGrantRecord, "user_id"> & {
  current_credit_usd: number;
};

export type SetUserActivePayload = {
  user_id: string;
  active: boolean;
};

export type SetUserActiveResponse = {
  user_id: string;
  is_active: boolean;
  current_credit_usd: number;
  credit_floor_usd: number;
};

export type AdminUserSummary = {
  id: string;
  email: string | null;
  full_name: string | null;
  image_url?: string | null;
  role: UserRole;
  is_active: boolean;
  current_credit_usd: number;
  credit_floor_usd: number;
  created_at_ms: number;
  last_sign_in_at_ms: number | null;
};

export type AdminUserListResponse = {
  items: AdminUserSummary[];
  limit: number;
  offset: number;
  has_more: boolean;
  query: string | null;
};
