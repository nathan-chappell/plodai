import { useEffect, useState } from "react";
import styled from "styled-components";

import { useAppState } from "../app/context";
import { MetaText } from "../app/styles";
import {
  createFreeCreditRequest,
  createPayPalPaymentAttempt,
  getPaymentIntegrationStatus,
  listFreeCreditRequests,
  listPayPalPaymentAttempts,
  uploadPayPalReceipt,
} from "../lib/api";
import type {
  FreeCreditRequestSummary,
  PaymentAttemptSummary,
  PaymentIntegrationResponse,
} from "../types/credits";
import {
  AdminPanelInput,
  AdminPanelNoteInput,
  AdminPanelSecondaryButton,
  AdminPanelSubmitButton,
} from "./styles";

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function AccountBillingPage() {
  const { user } = useAppState();
  const [paymentStatus, setPaymentStatus] = useState<PaymentIntegrationResponse | null>(null);
  const [paymentAttempts, setPaymentAttempts] = useState<PaymentAttemptSummary[]>([]);
  const [freeCreditRequests, setFreeCreditRequests] = useState<FreeCreditRequestSummary[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("10.00");
  const [freeCreditAmount, setFreeCreditAmount] = useState("5.00");
  const [freeCreditReason, setFreeCreditReason] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<File | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getPaymentIntegrationStatus(), listPayPalPaymentAttempts(), listFreeCreditRequests()])
      .then(([paymentResponse, attemptResponse, freeCreditResponse]) => {
        if (cancelled) {
          return;
        }
        setPaymentStatus(paymentResponse);
        setPaymentAttempts(attemptResponse.attempts);
        setFreeCreditRequests(freeCreditResponse.requests);
        setActiveAttemptId(attemptResponse.attempts[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Unable to load billing details.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableCredit = user === null ? 0 : Math.max(user.current_credit_usd - user.credit_floor_usd, 0);
  const activeAttempt = paymentAttempts.find((attempt) => attempt.id === activeAttemptId) ?? paymentAttempts[0] ?? null;

  async function createAttempt(): Promise<void> {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus("Enter a payment amount.");
      return;
    }
    try {
      const attempt = await createPayPalPaymentAttempt({ expected_amount_usd: amount });
      setPaymentAttempts((current) => [attempt, ...current]);
      setActiveAttemptId(attempt.id);
      setStatus("Payment reference created. Include it with the PayPal payment, then upload the receipt.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create payment reference.");
    }
  }

  async function uploadReceipt(): Promise<void> {
    if (!activeAttempt || !selectedReceipt) {
      setStatus("Choose a payment reference and receipt file first.");
      return;
    }
    try {
      const attempt = await uploadPayPalReceipt(activeAttempt.id, selectedReceipt);
      setPaymentAttempts((current) => current.map((candidate) => (candidate.id === attempt.id ? attempt : candidate)));
      setSelectedReceipt(null);
      setStatus(attempt.review_reason ?? `Receipt reviewed: ${attempt.status.replaceAll("_", " ")}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload receipt.");
    }
  }

  async function submitFreeCreditRequest(): Promise<void> {
    const requestedAmount = Number(freeCreditAmount);
    if (!freeCreditReason.trim()) {
      setStatus("Add a short note for the credit request.");
      return;
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      setStatus("Enter a positive free-credit amount.");
      return;
    }
    try {
      const request = await createFreeCreditRequest({
        requested_amount_usd: requestedAmount,
        source: "general",
        reason: freeCreditReason.trim(),
      });
      setFreeCreditRequests((current) => [request, ...current]);
      setFreeCreditReason("");
      setStatus(request.decision_note ?? `Free-credit request is ${request.status.replaceAll("_", " ")}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request free credit.");
    }
  }

  return (
    <AccountGrid aria-label="Billing and credits">
      <AccountSection>
        <Eyebrow>Credits</Eyebrow>
        <PanelTitle>{formatUsd(availableCredit)}</PanelTitle>
        <DetailList>
          <div>
            <dt>Current balance</dt>
            <dd>{formatUsd(user?.current_credit_usd ?? 0)}</dd>
          </div>
          <div>
            <dt>Credit floor</dt>
            <dd>{formatUsd(user?.credit_floor_usd ?? 0)}</dd>
          </div>
        </DetailList>
      </AccountSection>

      <AccountSection>
        <Eyebrow>Payments</Eyebrow>
        <PanelTitle>{paymentStatus?.receipt_upload_enabled ? "PayPal receipt credit" : "Payments unavailable"}</PanelTitle>
        <DetailList>
          <div>
            <dt>Provider</dt>
            <dd>{paymentStatus?.provider ?? "Loading"}</dd>
          </div>
          {paymentStatus?.paypal_recipient_email ? (
            <div>
              <dt>Send to</dt>
              <dd>{paymentStatus.paypal_recipient_email}</dd>
            </div>
          ) : null}
          <div>
            <dt>Status</dt>
            <dd>{status ?? paymentStatus?.reason ?? "Payment status is current."}</dd>
          </div>
        </DetailList>
        {paymentStatus?.receipt_upload_enabled ? (
          <ControlStack>
            <label>
              Amount
              <AdminPanelInput
                inputMode="decimal"
                onChange={(event) => setPaymentAmount(event.currentTarget.value)}
                value={paymentAmount}
              />
            </label>
            <AdminPanelSecondaryButton type="button" onClick={() => void createAttempt()}>
              New reference
            </AdminPanelSecondaryButton>
            {activeAttempt ? (
              <ReferenceBox>
                <strong>{activeAttempt.reference_code}</strong>
                <span>
                  {formatUsd(activeAttempt.expected_amount_usd)} {activeAttempt.expected_currency} /{" "}
                  {activeAttempt.status.replaceAll("_", " ")}
                </span>
                {paymentStatus.paypal_payment_url ? (
                  <a href={paymentStatus.paypal_payment_url} target="_blank" rel="noreferrer">
                    Open PayPal
                  </a>
                ) : null}
              </ReferenceBox>
            ) : null}
            <label>
              Receipt or invoice
              <AdminPanelInput
                type="file"
                accept=".txt,.pdf,.eml,.html,.htm,text/plain,application/pdf,text/html,message/rfc822"
                onChange={(event) => setSelectedReceipt(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            <AdminPanelSubmitButton
              type="button"
              disabled={!activeAttempt || !selectedReceipt}
              onClick={() => void uploadReceipt()}
            >
              Upload receipt
            </AdminPanelSubmitButton>
          </ControlStack>
        ) : null}
      </AccountSection>

      <AccountSection>
        <Eyebrow>Access</Eyebrow>
        <PanelTitle>Request free credit</PanelTitle>
        <DetailList>
          <div>
            <dt>Latest request</dt>
            <dd>{freeCreditRequests[0]?.status.replaceAll("_", " ") ?? "None"}</dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>{freeCreditRequests[0]?.decision_note ?? "Requests are reviewed by an admin."}</dd>
          </div>
        </DetailList>
        <ControlStack>
          <label>
            Amount
            <AdminPanelInput
              inputMode="decimal"
              onChange={(event) => setFreeCreditAmount(event.currentTarget.value)}
              value={freeCreditAmount}
            />
          </label>
          <label>
            Request note
            <AdminPanelNoteInput
              onChange={(event) => setFreeCreditReason(event.currentTarget.value)}
              placeholder="What are you trying to test or build?"
              value={freeCreditReason}
            />
          </label>
          <AdminPanelSubmitButton type="button" onClick={() => void submitFreeCreditRequest()}>
            Request credit
          </AdminPanelSubmitButton>
        </ControlStack>
      </AccountSection>
    </AccountGrid>
  );
}

const AccountGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  align-content: start;

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }
`;

const AccountSection = styled.section`
  display: grid;
  align-content: start;
  gap: 0.72rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: var(--shadow);
`;

const Eyebrow = styled.p`
  margin: 0;
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 1.12rem;
  line-height: 1.2;
`;

const DetailList = styled.dl`
  display: grid;
  gap: 0.45rem;
  margin: 0;

  div {
    display: grid;
    gap: 0.12rem;
  }

  dt {
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
`;

const ControlStack = styled.div`
  display: grid;
  gap: 0.55rem;

  label {
    display: grid;
    gap: 0.28rem;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
`;

const ReferenceBox = styled(MetaText)`
  display: grid;
  gap: 0.2rem;
  padding: 0.62rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.68);
`;
