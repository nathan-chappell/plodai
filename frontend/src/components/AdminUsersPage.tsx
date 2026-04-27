import { useMemo } from "react";

import { useAppState } from "../app/context";
import { apiRequest } from "../lib/api";
import { AdminPortfolioPanel } from "../../../vendor/ai-portfolio-admin/frontend";
import type {
  AdminPortfolioPanelCallbacks,
  AdminUserSummary as SharedAdminUserSummary,
  CreditGrantRecord,
  ManualCreditGrantRequest,
} from "../../../vendor/ai-portfolio-admin/frontend";
import type {
  AdminUserListResponse,
  AdminUserSummary as LocalAdminUserSummary,
  GrantCreditPayload,
  GrantCreditResponse,
  SetUserActivePayload,
  SetUserActiveResponse,
} from "../types/credits";

function toSharedUser(user: LocalAdminUserSummary): SharedAdminUserSummary {
  return {
    user_id: user.id,
    email: user.email,
    display_name: user.full_name,
    image_url: user.image_url ?? null,
    role: user.role,
    is_active: user.is_active,
    current_credit_usd: user.current_credit_usd,
    credit_floor_usd: user.credit_floor_usd,
    created_at_ms: user.created_at_ms,
    last_sign_in_at_ms: user.last_sign_in_at_ms,
  };
}

function updateSharedUser(
  userId: string,
  users: SharedAdminUserSummary[],
  response: SetUserActiveResponse,
): SharedAdminUserSummary {
  const current = users.find((candidate) => candidate.user_id === userId);
  return {
    user_id: response.user_id,
    email: current?.email ?? null,
    display_name: current?.display_name ?? null,
    image_url: current?.image_url ?? null,
    role: current?.role ?? "user",
    is_active: response.is_active,
    current_credit_usd: response.current_credit_usd,
    credit_floor_usd: response.credit_floor_usd,
    created_at_ms: current?.created_at_ms ?? null,
    last_sign_in_at_ms: current?.last_sign_in_at_ms ?? null,
  };
}

function toSharedGrant(payload: ManualCreditGrantRequest, response: GrantCreditResponse): CreditGrantRecord {
  return {
    id: payload.idempotency_key ?? `${response.user_id}-${Date.now()}`,
    user_id: response.user_id,
    admin_user_id: null,
    credit_amount_usd: payload.credit_amount_usd,
    source: payload.source ?? "admin_manual",
    note: payload.note,
    request_id: payload.request_id ?? null,
    payment_provider: null,
    payment_reference: payload.payment_reference ?? null,
    resulting_balance_usd: response.current_credit_usd,
    created_at: new Date().toISOString(),
  };
}

export function AdminUsersPage() {
  const { user, setUser } = useAppState();
  const callbacks = useMemo<AdminPortfolioPanelCallbacks>(() => {
    let latestUsers: SharedAdminUserSummary[] = [];
    return {
      async searchUsers(query, offset, limit) {
        const suffix = query.trim() ? `&query=${encodeURIComponent(query.trim())}` : "";
        const response = await apiRequest<AdminUserListResponse>(`/admin/users?limit=${limit}&offset=${offset}${suffix}`);
        latestUsers = response.items.map(toSharedUser);
        return {
          items: latestUsers,
          has_more: response.has_more,
        };
      },
      async setUserActive(userId, active) {
        const payload: SetUserActivePayload = {
          user_id: userId,
          active,
        };
        const response = await apiRequest<SetUserActiveResponse>("/admin/users/set-active", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const updated = updateSharedUser(userId, latestUsers, response);
        latestUsers = latestUsers.map((candidate) => (candidate.user_id === userId ? updated : candidate));
        if (userId === user?.id) {
          setUser((current) =>
            current
              ? {
                  ...current,
                  is_active: response.is_active,
                  current_credit_usd: response.current_credit_usd,
                  credit_floor_usd: response.credit_floor_usd,
                }
              : current,
          );
        }
        return updated;
      },
      async grantCredit(payload) {
        const grantPayload: GrantCreditPayload = {
          user_id: payload.user_id,
          credit_amount_usd: payload.credit_amount_usd,
          note: payload.note,
        };
        const response = await apiRequest<GrantCreditResponse>("/admin/credits/grant", {
          method: "POST",
          body: JSON.stringify(grantPayload),
        });
        if (response.user_id === user?.id) {
          setUser((current) =>
            current
              ? {
                  ...current,
                  current_credit_usd: response.current_credit_usd,
                }
              : current,
          );
        }
        return toSharedGrant(payload, response);
      },
    };
  }, [setUser, user?.id]);

  if (user?.role !== "admin") {
    return null;
  }

  return <AdminPortfolioPanel callbacks={callbacks} />;
}
