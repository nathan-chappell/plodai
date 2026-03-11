export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "user";
  is_active: boolean;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type ChatKitConfig = {
  user: string;
  model: string;
  tools: string[];
  notes: string[];
  server_ready: boolean;
};
