import { useState } from "react";

import { useAppState } from "../app/context";
import { apiRequest, ApiError } from "../lib/api";
import type {
  GrantCreditPayload,
  GrantCreditResponse,
  SetUserActivePayload,
  SetUserActiveResponse,
} from "../types/credits";
import { MetaText } from "../app/styles";
import {
  AdminPanelCard,
  AdminPanelForm,
  AdminPanelInput,
  AdminPanelMessage,
  AdminPanelModalActions,
  AdminPanelModalBackdrop,
  AdminPanelModalCard,
  AdminPanelNoteInput,
  AdminPanelRow,
  AdminPanelSecondaryButton,
  AdminPanelSubmitButton,
  AdminPanelTitle,
} from "./styles";

export function AdminCreditsPanel() {
  const { user, setUser } = useAppState();
  const [userId, setUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("5");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activationPromptOpen, setActivationPromptOpen] = useState(false);

  if (!user || user.role !== "admin") {
    return null;
  }
  const currentUser = user;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const payload: GrantCreditPayload = {
        user_id: userId.trim(),
        credit_amount_usd: Number(creditAmount),
        note: note.trim() || undefined,
      };
      const result = await apiRequest<GrantCreditResponse>("/admin/credits/grant", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStatus(`Updated ${result.user_id} to $${result.current_credit_usd.toFixed(2)}.`);
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
      if (error instanceof ApiError || error instanceof Error) {
        setStatus(error.message);
      } else {
        setStatus("Unable to grant credit.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(active: boolean, grantWelcomeCredit = false) {
    if (!userId.trim()) {
      setStatus("Enter a Clerk user id first.");
      return;
    }

    setSubmitting(true);
    setStatus(null);
    try {
      const payload: SetUserActivePayload = {
        user_id: userId.trim(),
        active,
        grant_welcome_credit: grantWelcomeCredit,
      };
      const result = await apiRequest<SetUserActiveResponse>("/admin/users/set-active", {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
      if (error instanceof ApiError || error instanceof Error) {
        setStatus(error.message);
      } else {
        setStatus("Unable to update activation.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminPanelCard>
      <AdminPanelTitle>Admin credits</AdminPanelTitle>
      <MetaText>Grant manual credit to a Clerk user id.</MetaText>
      <AdminPanelForm onSubmit={(event) => void handleSubmit(event)}>
        <AdminPanelInput
          onChange={(event) => setUserId(event.target.value)}
          placeholder="Clerk user id"
          value={userId}
        />
        <AdminPanelNoteInput
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note for this credit grant"
          rows={3}
          value={note}
        />
        <AdminPanelRow>
          <AdminPanelInput
            min="0.01"
            onChange={(event) => setCreditAmount(event.target.value)}
            placeholder="Credit amount"
            step="0.01"
            type="number"
            value={creditAmount}
          />
          <AdminPanelSubmitButton disabled={submitting || !userId.trim()} type="submit">
            {submitting ? "Saving..." : "Add credit"}
          </AdminPanelSubmitButton>
        </AdminPanelRow>
        <AdminPanelRow>
          <AdminPanelSecondaryButton
            disabled={submitting || !userId.trim()}
            onClick={() => setActivationPromptOpen(true)}
            type="button"
          >
            Activate
          </AdminPanelSecondaryButton>
          <AdminPanelSecondaryButton
            disabled={submitting || !userId.trim()}
            onClick={() => void handleSetActive(false)}
            type="button"
          >
            Deactivate
          </AdminPanelSecondaryButton>
        </AdminPanelRow>
      </AdminPanelForm>
      <MetaText>Signed-in balance: ${currentUser.current_credit_usd.toFixed(2)}</MetaText>
      {status ? <AdminPanelMessage>{status}</AdminPanelMessage> : null}
      {activationPromptOpen ? (
        <AdminPanelModalBackdrop>
          <AdminPanelModalCard>
            <AdminPanelTitle>Activate user</AdminPanelTitle>
            <MetaText>Activate this Clerk user and optionally add the default $1.00 welcome credit.</MetaText>
            <MetaText>User id: {userId.trim() || "Not set"}</MetaText>
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
