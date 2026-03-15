import { useEffect, useMemo, useState } from "react";

import { useAppState } from "../app/context";
import { MetaText } from "../app/styles";
import { apiRequest, ApiError } from "../lib/api";
import type {
  AdminUserListResponse,
  AdminUserSummary,
  GrantCreditPayload,
  GrantCreditResponse,
  SetUserActivePayload,
  SetUserActiveResponse,
} from "../types/credits";
import {
  AdminPanelActionCell,
  AdminPanelBadge,
  AdminPanelBadgeRow,
  AdminPanelCard,
  AdminPanelCell,
  AdminPanelForm,
  AdminPanelHeaderCell,
  AdminPanelInlineMeta,
  AdminPanelInput,
  AdminPanelMessage,
  AdminPanelModalActions,
  AdminPanelModalBackdrop,
  AdminPanelModalCard,
  AdminPanelNoteInput,
  AdminPanelPager,
  AdminPanelRow,
  AdminPanelSecondaryButton,
  AdminPanelSubmitButton,
  AdminPanelTable,
  AdminPanelTableWrap,
  AdminPanelTitle,
  AdminPanelToolbar,
  AdminPanelUserButton,
} from "./styles";

const PAGE_SIZE = 10;

function formatTimestamp(timestampMs: number | null): string {
  if (!timestampMs) {
    return "Never";
  }
  return new Date(timestampMs).toLocaleDateString();
}

export function AdminCreditsPanel() {
  const { user, setUser } = useAppState();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("5");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activationPromptOpen, setActivationPromptOpen] = useState(false);
  const [creditPromptOpen, setCreditPromptOpen] = useState(false);

  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  useEffect(() => {
    if (!user || user.role !== "admin") {
      return;
    }

    let cancelled = false;
    setLoadingUsers(true);

    void apiRequest<AdminUserListResponse>(
      `/admin/users?limit=${PAGE_SIZE}&offset=${offset}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
    )
      .then((response) => {
        if (cancelled) {
          return;
        }
        setUsers(response.items);
        setHasMore(response.has_more);
        setSelectedUserId((current) => {
          if (current && response.items.some((candidate) => candidate.id === current)) {
            return current;
          }
          return response.items[0]?.id ?? "";
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setStatus(error instanceof Error ? error.message : "Unable to load users.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [offset, query, user]);

  if (!user || user.role !== "admin") {
    return null;
  }

  const currentUser = user;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) {
      setStatus("Select a user first.");
      return;
    }
    if (!note.trim()) {
      setStatus("Add a short note for the credit grant.");
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      const payload: GrantCreditPayload = {
        user_id: selectedUserId,
        credit_amount_usd: Number(creditAmount),
        note: note.trim(),
      };
      const result = await apiRequest<GrantCreditResponse>("/admin/credits/grant", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === result.user_id
            ? { ...candidate, current_credit_usd: result.current_credit_usd }
            : candidate,
        ),
      );
      setStatus(`Updated ${result.user_id} to $${result.current_credit_usd.toFixed(2)}.`);
      setCreditPromptOpen(false);
      setNote("");
      if (result.user_id === currentUser.id) {
        setUser((current) =>
          current
            ? {
                ...current,
                current_credit_usd: result.current_credit_usd,
              }
            : current,
        );
      }
    } catch (error) {
      setStatus(error instanceof ApiError || error instanceof Error ? error.message : "Unable to grant credit.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(active: boolean, grantWelcomeCredit = false) {
    if (!selectedUserId) {
      setStatus("Select a user first.");
      return;
    }

    setSubmitting(true);
    setStatus(null);
    try {
      const payload: SetUserActivePayload = {
        user_id: selectedUserId,
        active,
        grant_welcome_credit: grantWelcomeCredit,
      };
      const result = await apiRequest<SetUserActiveResponse>("/admin/users/set-active", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === result.user_id
            ? {
                ...candidate,
                is_active: result.is_active,
                current_credit_usd: result.current_credit_usd,
              }
            : candidate,
        ),
      );
      setStatus(
        `${result.user_id} is now ${result.is_active ? "active" : "inactive"} with $${result.current_credit_usd.toFixed(2)}.`,
      );
      if (result.user_id === currentUser.id) {
        setUser((current) =>
          current
            ? {
                ...current,
                is_active: result.is_active,
                current_credit_usd: result.current_credit_usd,
              }
            : current,
        );
      }
    } catch (error) {
      setStatus(error instanceof ApiError || error instanceof Error ? error.message : "Unable to update activation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminPanelCard>
      <AdminPanelTitle>User access</AdminPanelTitle>
      <MetaText>Browse Clerk users, then grant credit or update activation inline.</MetaText>

      <AdminPanelToolbar>
        <AdminPanelInput
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder="Filter by name, email, or username"
          value={draftQuery}
        />
        <AdminPanelSecondaryButton
          onClick={() => {
            setOffset(0);
            setQuery(draftQuery.trim());
          }}
          type="button"
        >
          Search
        </AdminPanelSecondaryButton>
        <AdminPanelSecondaryButton
          onClick={() => {
            setDraftQuery("");
            setQuery("");
            setOffset(0);
          }}
          type="button"
        >
          Clear
        </AdminPanelSecondaryButton>
      </AdminPanelToolbar>

      <AdminPanelTableWrap>
        <AdminPanelTable>
          <thead>
            <tr>
              <AdminPanelHeaderCell>User</AdminPanelHeaderCell>
              <AdminPanelHeaderCell>Status</AdminPanelHeaderCell>
              <AdminPanelHeaderCell>Credit</AdminPanelHeaderCell>
              <AdminPanelHeaderCell>Last sign-in</AdminPanelHeaderCell>
              <AdminPanelHeaderCell>Actions</AdminPanelHeaderCell>
            </tr>
          </thead>
          <tbody>
            {users.map((candidate) => {
              const displayName = candidate.full_name || candidate.email || candidate.id;
              return (
                <tr key={candidate.id}>
                  <AdminPanelCell>
                    <AdminPanelUserButton
                      $active={candidate.id === selectedUserId}
                      onClick={() => setSelectedUserId(candidate.id)}
                      type="button"
                    >
                      <strong>{displayName}</strong>
                      <AdminPanelInlineMeta>{candidate.email ?? candidate.id}</AdminPanelInlineMeta>
                    </AdminPanelUserButton>
                  </AdminPanelCell>
                  <AdminPanelCell>
                    <AdminPanelBadgeRow>
                      <AdminPanelBadge $tone={candidate.is_active ? "accent" : "muted"}>
                        {candidate.is_active ? "Active" : "Inactive"}
                      </AdminPanelBadge>
                      {candidate.role === "admin" ? <AdminPanelBadge>Admin capabilities</AdminPanelBadge> : null}
                    </AdminPanelBadgeRow>
                  </AdminPanelCell>
                  <AdminPanelCell>${candidate.current_credit_usd.toFixed(2)}</AdminPanelCell>
                  <AdminPanelCell>{formatTimestamp(candidate.last_sign_in_at_ms)}</AdminPanelCell>
                  <AdminPanelActionCell>
                    <AdminPanelSecondaryButton
                      onClick={() => {
                        setSelectedUserId(candidate.id);
                        setCreditPromptOpen(true);
                      }}
                      type="button"
                    >
                      Add credit
                    </AdminPanelSecondaryButton>
                    <AdminPanelSecondaryButton
                      onClick={() => {
                        setSelectedUserId(candidate.id);
                        if (candidate.is_active) {
                          void handleSetActive(false);
                          return;
                        }
                        setActivationPromptOpen(true);
                      }}
                      type="button"
                    >
                      {candidate.is_active ? "Deactivate" : "Activate"}
                    </AdminPanelSecondaryButton>
                  </AdminPanelActionCell>
                </tr>
              );
            })}
          </tbody>
        </AdminPanelTable>
      </AdminPanelTableWrap>

      <AdminPanelPager>
        <MetaText>
          {loadingUsers
            ? "Loading users..."
            : selectedUser
              ? `Selected: ${selectedUser.full_name || selectedUser.email || selectedUser.id}`
              : "Select a user to manage access and credits."}
        </MetaText>
        <AdminPanelRow>
          <AdminPanelSecondaryButton disabled={offset === 0 || loadingUsers} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))} type="button">
            Previous
          </AdminPanelSecondaryButton>
          <AdminPanelSecondaryButton disabled={!hasMore || loadingUsers} onClick={() => setOffset((current) => current + PAGE_SIZE)} type="button">
            Next
          </AdminPanelSecondaryButton>
        </AdminPanelRow>
      </AdminPanelPager>

      <MetaText>Signed-in balance: ${currentUser.current_credit_usd.toFixed(2)}</MetaText>
      {status ? <AdminPanelMessage>{status}</AdminPanelMessage> : null}

      {creditPromptOpen ? (
        <AdminPanelModalBackdrop>
          <AdminPanelModalCard>
            <AdminPanelTitle>Add credit</AdminPanelTitle>
            <MetaText>Grant manual credit to the selected user. Amount and comment are both required.</MetaText>
            <MetaText>User: {selectedUser?.full_name || selectedUser?.email || selectedUserId}</MetaText>
            <AdminPanelForm onSubmit={(event) => void handleSubmit(event)}>
              <AdminPanelInput
                min="0.01"
                onChange={(event) => setCreditAmount(event.target.value)}
                placeholder="Credit amount"
                step="0.01"
                type="number"
                value={creditAmount}
              />
              <AdminPanelNoteInput
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why are you granting this credit?"
                rows={3}
                value={note}
              />
              <AdminPanelModalActions>
                <AdminPanelSecondaryButton onClick={() => setCreditPromptOpen(false)} type="button">
                  Cancel
                </AdminPanelSecondaryButton>
                <AdminPanelSubmitButton disabled={submitting || !selectedUserId} type="submit">
                  {submitting ? "Saving..." : "Add credit"}
                </AdminPanelSubmitButton>
              </AdminPanelModalActions>
            </AdminPanelForm>
          </AdminPanelModalCard>
        </AdminPanelModalBackdrop>
      ) : null}

      {activationPromptOpen ? (
        <AdminPanelModalBackdrop>
          <AdminPanelModalCard>
            <AdminPanelTitle>Activate user</AdminPanelTitle>
            <MetaText>Activate this Clerk user and optionally add the default $1.00 welcome credit.</MetaText>
            <MetaText>User id: {selectedUserId || "Not set"}</MetaText>
            <AdminPanelModalActions>
              <AdminPanelSecondaryButton onClick={() => setActivationPromptOpen(false)} type="button">
                Cancel
              </AdminPanelSecondaryButton>
              <AdminPanelSecondaryButton
                onClick={() => {
                  setActivationPromptOpen(false);
                  void handleSetActive(true, false);
                }}
                type="button"
              >
                Activate only
              </AdminPanelSecondaryButton>
              <AdminPanelSubmitButton
                onClick={() => {
                  setActivationPromptOpen(false);
                  void handleSetActive(true, true);
                }}
                type="button"
              >
                Activate + $1.00
              </AdminPanelSubmitButton>
            </AdminPanelModalActions>
          </AdminPanelModalCard>
        </AdminPanelModalBackdrop>
      ) : null}
    </AdminPanelCard>
  );
}
