from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_portfolio_admin.contracts import PaymentAttemptRecord
from ai_portfolio_admin.payments import PayPalReceiptWorkflow

from backend.app.core.config import Settings, get_settings
from backend.app.models.payment_attempt import PaymentAttempt
from backend.app.schemas.credits import PaymentAttemptStatus, PaymentAttemptSummary
from backend.app.services.credit_service import CreditService


class PaymentService:
    def __init__(self, db: AsyncSession, settings: Settings | None = None):
        self.db = db
        self.settings = settings if settings is not None else get_settings()

    async def create_paypal_attempt(
        self, *, user_id: str, expected_amount_usd: float
    ) -> PaymentAttemptSummary:
        workflow = self._paypal_workflow()
        attempt = PaymentAttempt(
            user_id=user_id,
            expected_amount_usd=workflow.normalize_payment_amount(expected_amount_usd),
            reference_code=workflow.new_reference_code(),
            provider="paypal",
            expected_currency="USD",
            status="pending_payment",
        )
        self.db.add(attempt)
        await self.db.commit()
        await self.db.refresh(attempt)
        return _payment_attempt_summary(attempt)

    async def list_user_attempts(self, *, user_id: str) -> list[PaymentAttemptSummary]:
        result = await self.db.execute(
            select(PaymentAttempt)
            .where(PaymentAttempt.user_id == user_id)
            .order_by(PaymentAttempt.created_at.desc())
            .limit(20)
        )
        return [_payment_attempt_summary(row) for row in result.scalars().all()]

    async def list_admin_attempts(
        self,
        *,
        status: PaymentAttemptStatus | None,
        limit: int = 50,
    ) -> list[PaymentAttemptSummary]:
        statement = select(PaymentAttempt).order_by(PaymentAttempt.created_at.desc()).limit(limit)
        if status is not None:
            statement = statement.where(PaymentAttempt.status == status)
        result = await self.db.execute(statement)
        return [_payment_attempt_summary(row) for row in result.scalars().all()]

    async def review_receipt_upload(
        self,
        *,
        user_id: str,
        attempt_id: str,
        filename: str,
        media_type: str | None,
        payload: bytes,
    ) -> PaymentAttemptSummary:
        attempt = await self.db.get(PaymentAttempt, attempt_id)
        if attempt is None or attempt.user_id != user_id:
            raise FileNotFoundError("Payment attempt was not found.")
        if attempt.status in {"confirmed_paid", "rejected_payment"}:
            raise ValueError("This payment attempt is already closed.")

        outcome = self._paypal_workflow().review_receipt(
            _payment_attempt_record(attempt),
            payload=payload,
            media_type=media_type,
        )
        decision_status: PaymentAttemptStatus = outcome.status
        decision_reason = outcome.decision_reason
        review_payload = dict(outcome.review_payload)
        if outcome.provider_reference:
            duplicate = await self.db.scalar(
                select(PaymentAttempt).where(
                    PaymentAttempt.provider_reference == outcome.provider_reference,
                    PaymentAttempt.id != attempt.id,
                )
            )
            if duplicate is not None:
                decision_status = "manual_review_required"
                decision_reason = "Receipt transaction ID was already used on another payment attempt."
                review_payload["decision_reason"] = decision_reason

        attempt.provider_reference = outcome.provider_reference
        attempt.receipt_filename = filename[:255]
        attempt.receipt_media_type = (media_type or "application/octet-stream")[:128]
        attempt.receipt_text_excerpt = outcome.receipt_text_excerpt
        attempt.review_json = review_payload
        attempt.status = decision_status
        attempt.decision_note = decision_reason
        attempt.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(attempt)

        if attempt.status == "temporarily_approved" and attempt.credit_grant_id is None:
            await self._grant_attempt_credit(
                attempt_id=attempt.id,
                user_id=user_id,
                amount_usd=float(attempt.expected_amount_usd),
                note=f"Temporary PayPal receipt approval: {attempt.reference_code}",
                provider_reference=attempt.provider_reference,
            )
            refreshed = await self.db.get(PaymentAttempt, attempt.id)
            if refreshed is None:
                raise FileNotFoundError("Payment attempt was not found after approval.")
            return _payment_attempt_summary(refreshed)

        return _payment_attempt_summary(attempt)

    async def decide_admin_attempt(
        self,
        *,
        attempt_id: str,
        admin_user_id: str,
        status: Literal["confirmed_paid", "rejected_payment", "manual_review_required"],
        decision_note: str,
        credit_amount_usd: float | None,
        provider_reference: str | None,
    ) -> PaymentAttemptSummary:
        attempt = await self.db.get(PaymentAttempt, attempt_id)
        if attempt is None:
            raise FileNotFoundError("Payment attempt was not found.")
        attempt.status = status
        attempt.decision_note = decision_note.strip()
        if provider_reference and provider_reference.strip():
            attempt.provider_reference = provider_reference.strip()
        if status == "confirmed_paid":
            attempt.temporary_access_expires_at = None
        attempt.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(attempt)

        if status == "confirmed_paid" and attempt.credit_grant_id is None:
            await self._grant_attempt_credit(
                attempt_id=attempt.id,
                user_id=attempt.user_id,
                amount_usd=credit_amount_usd or float(attempt.expected_amount_usd),
                note=f"Admin-confirmed PayPal payment: {attempt.reference_code}. {decision_note.strip()}",
                provider_reference=attempt.provider_reference,
                admin_user_id=admin_user_id,
            )
            refreshed = await self.db.get(PaymentAttempt, attempt.id)
            if refreshed is None:
                raise FileNotFoundError("Payment attempt was not found after confirmation.")
            return _payment_attempt_summary(refreshed)
        if status == "rejected_payment" and attempt.credit_grant_id is not None:
            await self._revoke_attempt_credit(
                attempt_id=attempt.id,
                user_id=attempt.user_id,
                amount_usd=float(attempt.expected_amount_usd),
                note=f"Revoked PayPal receipt credit: {attempt.reference_code}. {decision_note.strip()}",
                admin_user_id=admin_user_id,
                provider_reference=attempt.provider_reference,
            )
            refreshed = await self.db.get(PaymentAttempt, attempt.id)
            if refreshed is None:
                raise FileNotFoundError("Payment attempt was not found after rejection.")
            return _payment_attempt_summary(refreshed)
        return _payment_attempt_summary(attempt)

    async def _grant_attempt_credit(
        self,
        *,
        attempt_id: str,
        user_id: str,
        amount_usd: float,
        note: str,
        provider_reference: str | None,
        admin_user_id: str | None = None,
    ) -> None:
        _, grant = await CreditService(self.db).grant_credit_record(
            user_id,
            amount_usd,
            admin_user_id=admin_user_id,
            note=note,
            source="paypal_receipt",
            payment_provider="paypal",
            payment_reference=provider_reference or attempt_id,
        )
        attempt = await self.db.get(PaymentAttempt, attempt_id)
        if attempt is None:
            raise FileNotFoundError("Payment attempt was not found after credit grant.")
        attempt.credit_grant_id = grant.id
        attempt.temporary_access_expires_at = None
        attempt.updated_at = _utcnow()
        await self.db.commit()

    async def _revoke_attempt_credit(
        self,
        *,
        attempt_id: str,
        user_id: str,
        amount_usd: float,
        note: str,
        admin_user_id: str,
        provider_reference: str | None,
    ) -> None:
        await CreditService(self.db).adjust_credit_record(
            user_id,
            -abs(amount_usd),
            admin_user_id=admin_user_id,
            note=note,
            source="paypal_reversal",
            payment_provider="paypal",
            payment_reference=provider_reference or attempt_id,
        )

    def _paypal_workflow(self) -> PayPalReceiptWorkflow:
        recipient = (self.settings.paypal_recipient_email or "").strip()
        if not recipient:
            raise RuntimeError("PAYPAL_RECIPIENT_EMAIL is required for receipt-based PayPal credit.")
        return PayPalReceiptWorkflow(
            recipient_email=recipient,
            reference_prefix="PLODAI",
            min_payment_usd=self.settings.paypal_min_payment_usd,
            max_payment_usd=self.settings.paypal_max_payment_usd,
        )


def _payment_attempt_summary(attempt: PaymentAttempt) -> PaymentAttemptSummary:
    reason = attempt.review_json.get("decision_reason")
    return PaymentAttemptSummary(
        id=attempt.id,
        user_id=attempt.user_id,
        provider=attempt.provider,
        expected_amount_usd=round(float(attempt.expected_amount_usd), 2),
        expected_currency=attempt.expected_currency,
        reference_code=attempt.reference_code,
        status=cast(PaymentAttemptStatus, attempt.status),
        temporary_access_expires_at=attempt.temporary_access_expires_at,
        provider_reference=attempt.provider_reference,
        credit_grant_id=attempt.credit_grant_id,
        receipt_filename=attempt.receipt_filename,
        review_reason=reason if isinstance(reason, str) else attempt.decision_note,
        decision_note=attempt.decision_note,
        created_at=attempt.created_at,
        updated_at=attempt.updated_at,
    )


def _payment_attempt_record(attempt: PaymentAttempt) -> PaymentAttemptRecord:
    return PaymentAttemptRecord(
        id=attempt.id,
        user_id=attempt.user_id,
        provider="paypal",
        expected_amount_usd=round(float(attempt.expected_amount_usd), 2),
        expected_currency=attempt.expected_currency,
        reference_code=attempt.reference_code,
        status=cast(PaymentAttemptStatus, attempt.status),
        temporary_access_expires_at=attempt.temporary_access_expires_at,
        provider_reference=attempt.provider_reference,
        created_at=attempt.created_at,
    )


def _utcnow() -> datetime:
    return datetime.now(UTC)
