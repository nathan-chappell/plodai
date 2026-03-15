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
