import type {
  CreditGrantRecord,
  FreeCreditRequestRecord,
  FreeCreditRequestStatus,
  PaymentAttemptRecord,
  PaymentAttemptStatus,
  ManualCreditGrantRequest,
  UserRole,
} from "../../../vendor/ai-portfolio-admin/frontend/types";

export type { FreeCreditRequestStatus, PaymentAttemptStatus };

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

export type PaymentIntegrationResponse = {
  provider: string;
  checkout_enabled: boolean;
  receipt_upload_enabled: boolean;
  reason: string | null;
  paypal_recipient_email: string | null;
  paypal_payment_url: string | null;
  min_payment_usd: number;
  max_payment_usd: number;
};

export type PayPalPaymentAttemptCreateRequest = {
  expected_amount_usd: number;
};

export type PaymentAttemptSummary = Omit<PaymentAttemptRecord, "user_id" | "created_at"> & {
  user_id: string;
  credit_grant_id: string | null;
  receipt_filename: string | null;
  review_reason: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentAttemptListResponse = {
  attempts: PaymentAttemptSummary[];
};

export type AdminPaymentAttemptDecisionRequest = {
  attempt_id: string;
  status: Extract<PaymentAttemptStatus, "confirmed_paid" | "rejected_payment" | "manual_review_required">;
  decision_note: string;
  credit_amount_usd?: number | null;
  provider_reference?: string | null;
};

export type FreeCreditRequestCreate = {
  requested_amount_usd?: number | null;
  source?: "general" | "linkedin_connection" | "beta_tester" | "manual_admin";
  reason: string;
  linkedin_profile_url?: string | null;
  relationship_note?: string | null;
  intended_use?: string | null;
  idempotency_key?: string | null;
};

export type FreeCreditRequestSummary = FreeCreditRequestRecord & {
  updated_at: string;
};

export type FreeCreditRequestListResponse = {
  requests: FreeCreditRequestSummary[];
};

export type AdminFreeCreditDecisionRequest = {
  request_id: string;
  status: Extract<FreeCreditRequestStatus, "approved" | "rejected" | "manual_review_required">;
  credit_amount_usd?: number | null;
  decision_note: string;
};
