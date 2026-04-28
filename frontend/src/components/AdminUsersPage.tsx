import { useMemo } from "react";
import styled from "styled-components";

import { useAppState } from "../app/context";
import {
  apiRequest,
  decideAdminFreeCreditRequest,
  decideAdminPaymentAttempt,
  listAdminFreeCreditRequests,
  listAdminPaymentAttempts,
} from "../lib/api";
import { AdminPortfolioPanel } from "../../../vendor/ai-portfolio-admin/frontend";
import type {
  AdminPortfolioPanelCallbacks,
  AdminUserSummary as SharedAdminUserSummary,
  CreditGrantRecord,
  FreeCreditRequestRecord as SharedFreeCreditRequestRecord,
  ManualCreditGrantRequest,
  PaymentAttemptRecord as SharedPaymentAttemptRecord,
} from "../../../vendor/ai-portfolio-admin/frontend";
import type {
  AdminUserListResponse,
  AdminUserSummary as LocalAdminUserSummary,
  FreeCreditRequestSummary,
  GrantCreditPayload,
  GrantCreditResponse,
  PaymentAttemptSummary,
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

function toSharedPaymentAttempt(attempt: PaymentAttemptSummary): SharedPaymentAttemptRecord {
  return {
    id: attempt.id,
    user_id: attempt.user_id,
    provider: "paypal",
    expected_amount_usd: attempt.expected_amount_usd,
    expected_currency: attempt.expected_currency,
    reference_code: attempt.reference_code,
    status: attempt.status,
    temporary_access_expires_at: attempt.temporary_access_expires_at,
    provider_reference: attempt.provider_reference,
    created_at: attempt.created_at,
  };
}

function toSharedFreeCreditRequest(request: FreeCreditRequestSummary): SharedFreeCreditRequestRecord {
  return {
    id: request.id,
    user_id: request.user_id,
    requested_amount_usd: request.requested_amount_usd,
    source: request.source,
    reason: request.reason,
    linkedin_profile_url: request.linkedin_profile_url,
    relationship_note: request.relationship_note,
    intended_use: request.intended_use,
    evidence_verified: request.evidence_verified,
    idempotency_key: request.idempotency_key,
    status: request.status,
    decided_amount_usd: request.decided_amount_usd,
    decision_note: request.decision_note,
    reviewer_user_id: request.reviewer_user_id,
    credit_grant_id: request.credit_grant_id,
    created_at: request.created_at,
    decided_at: request.decided_at,
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
      async listFreeCreditRequests(status) {
        const response = await listAdminFreeCreditRequests(status);
        return response.requests.map(toSharedFreeCreditRequest);
      },
      async decideFreeCreditRequest(payload) {
        const response = await decideAdminFreeCreditRequest({
          request_id: payload.request_id,
          status: payload.status,
          credit_amount_usd: payload.credit_amount_usd,
          decision_note: payload.decision_note,
        });
        return toSharedFreeCreditRequest(response);
      },
      async listPaymentAttempts(status) {
        const response = await listAdminPaymentAttempts(status);
        return response.attempts.map(toSharedPaymentAttempt);
      },
      async decidePaymentAttempt(payload) {
        const response = await decideAdminPaymentAttempt({
          attempt_id: payload.attempt_id,
          status: payload.status,
          decision_note: payload.decision_note,
          credit_amount_usd: payload.credit_amount_usd,
          provider_reference: payload.provider_reference,
        });
        return toSharedPaymentAttempt(response);
      },
    };
  }, [setUser, user?.id]);

  if (user?.role !== "admin") {
    return null;
  }

  return (
    <AdminUsersShell>
      <AdminPortfolioPanel callbacks={callbacks} />
    </AdminUsersShell>
  );
}

const AdminUsersShell = styled.section`
  width: min(1180px, 100%);
  margin: 0 auto;
  min-width: 0;

  .admin-portfolio-panel {
    display: grid;
    gap: 0.78rem;
    color: var(--ink);
  }

  .admin-portfolio-panel h2,
  .admin-portfolio-panel h3,
  .admin-portfolio-panel p {
    margin: 0;
  }

  .admin-portfolio-panel__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
    gap: 1rem;
    align-items: end;
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 18px 46px rgba(21, 128, 61, 0.08);
  }

  .admin-portfolio-panel__header h2 {
    font-size: 1.34rem;
    line-height: 1.15;
  }

  .admin-portfolio-panel__header p,
  .admin-portfolio-panel__grant p,
  .admin-portfolio-panel__review p,
  .admin-portfolio-panel td span,
  .admin-portfolio-panel__empty,
  .admin-portfolio-panel__loading {
    color: var(--muted);
  }

  .admin-portfolio-panel__toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.45rem;
  }

  .admin-portfolio-panel input,
  .admin-portfolio-panel textarea,
  .admin-portfolio-panel select {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.62rem 0.72rem;
    background: rgba(255, 255, 255, 0.86);
    color: var(--ink);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.68);
  }

  .admin-portfolio-panel textarea {
    min-height: 5.1rem;
    resize: vertical;
  }

  .admin-portfolio-panel button {
    appearance: none;
    min-height: 2.15rem;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 0.48rem 0.68rem;
    background: var(--ink);
    color: white;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
  }

  .admin-portfolio-panel button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .admin-portfolio-panel button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .admin-portfolio-panel__button--primary {
    background: var(--accent-deep);
  }

  .admin-portfolio-panel__button--secondary,
  .admin-portfolio-panel__pager button {
    border-color: var(--line);
    background: rgba(255, 255, 255, 0.76);
    color: var(--ink);
  }

  .admin-portfolio-panel__button--positive {
    background: var(--accent-deep);
  }

  .admin-portfolio-panel__button--danger {
    border-color: rgba(185, 28, 28, 0.22);
    background: rgba(255, 255, 255, 0.78);
    color: #991b1b;
  }

  .admin-portfolio-panel__status,
  .admin-portfolio-panel__loading {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.64rem 0.78rem;
    background: rgba(255, 255, 255, 0.64);
  }

  .admin-portfolio-panel__table-wrap {
    min-width: 0;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.7);
    box-shadow: 0 18px 46px rgba(21, 128, 61, 0.07);
  }

  .admin-portfolio-panel__table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
  }

  .admin-portfolio-panel th,
  .admin-portfolio-panel td {
    padding: 0.72rem 0.82rem;
    text-align: left;
    border-bottom: 1px solid rgba(31, 41, 55, 0.09);
    vertical-align: middle;
  }

  .admin-portfolio-panel th {
    color: var(--muted);
    background: rgba(255, 255, 255, 0.72);
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .admin-portfolio-panel tbody tr:last-child td {
    border-bottom: 0;
  }

  .admin-portfolio-panel__user-row--selected td {
    background: color-mix(in srgb, var(--accent) 8%, white 92%);
  }

  .admin-portfolio-panel__user-row--inactive {
    opacity: 0.72;
  }

  .admin-portfolio-panel__identity-cell,
  .admin-portfolio-panel__credit-cell {
    display: grid;
    gap: 0.18rem;
    min-width: 12rem;
  }

  .admin-portfolio-panel__identity-cell span,
  .admin-portfolio-panel__credit-cell span {
    overflow-wrap: anywhere;
    font-size: 0.78rem;
  }

  .admin-portfolio-panel__actions-cell {
    display: flex;
    justify-content: flex-end;
    gap: 0.42rem;
    white-space: nowrap;
  }

  .admin-portfolio-panel__pill {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.18rem 0.48rem;
    background: rgba(255, 255, 255, 0.72);
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1;
    text-transform: capitalize;
  }

  .admin-portfolio-panel__pill--positive {
    border-color: color-mix(in srgb, var(--accent) 40%, rgba(31, 41, 55, 0.1));
    background: color-mix(in srgb, var(--accent) 12%, white 88%);
    color: var(--accent-deep);
  }

  .admin-portfolio-panel__pill--muted {
    background: rgba(31, 41, 55, 0.06);
  }

  .admin-portfolio-panel__pager {
    display: flex;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .admin-portfolio-panel__workbench,
  .admin-portfolio-panel__review-grid {
    display: grid;
    gap: 0.78rem;
  }

  .admin-portfolio-panel__grant,
  .admin-portfolio-panel__review {
    display: grid;
    gap: 0.72rem;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.9rem;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 18px 46px rgba(21, 128, 61, 0.06);
  }

  .admin-portfolio-panel__grant-fields {
    display: grid;
    grid-template-columns: minmax(8rem, 0.28fr) minmax(0, 1fr);
    gap: 0.65rem;
    align-items: start;
  }

  .admin-portfolio-panel__grant label {
    display: grid;
    gap: 0.34rem;
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 800;
  }

  .admin-portfolio-panel__review-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-portfolio-panel__review header,
  .admin-portfolio-panel__review-item > div:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
  }

  .admin-portfolio-panel__review select {
    width: min(16rem, 100%);
  }

  .admin-portfolio-panel__review-item {
    display: grid;
    gap: 0.5rem;
    border: 1px solid rgba(31, 41, 55, 0.1);
    border-radius: 8px;
    padding: 0.7rem;
    background: rgba(255, 255, 255, 0.58);
  }

  .admin-portfolio-panel__review-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.42rem;
  }

  .admin-portfolio-panel__empty {
    display: grid;
    min-height: 4.5rem;
    place-items: center;
    border: 1px dashed var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.44);
    text-align: center;
  }

  @media (max-width: 900px) {
    .admin-portfolio-panel__header,
    .admin-portfolio-panel__review-grid,
    .admin-portfolio-panel__grant-fields {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .admin-portfolio-panel__header,
    .admin-portfolio-panel__grant,
    .admin-portfolio-panel__review {
      padding: 0.75rem;
    }

    .admin-portfolio-panel__toolbar,
    .admin-portfolio-panel__review header {
      grid-template-columns: 1fr;
      display: grid;
    }

    .admin-portfolio-panel__actions-cell,
    .admin-portfolio-panel__pager {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }
`;
