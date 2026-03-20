export type AuthUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "user";
  is_active: boolean;
  current_credit_usd: number;
  credit_floor_usd: number;
};
