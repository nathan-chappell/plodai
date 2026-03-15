export type GrantCreditPayload = {
  user_id: string;
  credit_amount_usd: number;
  note?: string;
};

export type GrantCreditResponse = {
  user_id: string;
  current_credit_usd: number;
};

export type SetUserActivePayload = {
  user_id: string;
  active: boolean;
  grant_welcome_credit?: boolean;
};

export type SetUserActiveResponse = {
  user_id: string;
  is_active: boolean;
  current_credit_usd: number;
};

export type AdminUserSummary = {
  id: string;
  email: string | null;
  full_name: string | null;
  image_url?: string | null;
  role: "admin" | "user";
  is_active: boolean;
  current_credit_usd: number;
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
