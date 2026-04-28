from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_portfolio_admin.contracts import FreeCreditRequestCreate as SharedFreeCreditRequestCreate
from ai_portfolio_admin.credit_policy import FreeCreditPolicy, evaluate_free_credit_request

from backend.app.models.free_credit_request import FreeCreditRequest
from backend.app.schemas.credits import (
    FreeCreditRequestCreate,
    FreeCreditRequestStatus,
    FreeCreditRequestSummary,
    FreeCreditSource,
)
from backend.app.services.credit_service import CreditService

ACTIVE_FREE_CREDIT_STATUSES = {"pending", "manual_review_required"}


class FreeCreditService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.policy = FreeCreditPolicy.early_access_defaults()

    async def create_request(
        self,
        *,
        user_id: str,
        payload: FreeCreditRequestCreate,
    ) -> FreeCreditRequestSummary:
        if payload.idempotency_key:
            existing = await self.db.scalar(
                select(FreeCreditRequest).where(
                    FreeCreditRequest.user_id == user_id,
                    FreeCreditRequest.idempotency_key == payload.idempotency_key,
                )
            )
            if existing is not None:
                return _free_credit_summary(existing)

        active_request = await self.db.scalar(
            select(FreeCreditRequest).where(
                FreeCreditRequest.user_id == user_id,
                FreeCreditRequest.status.in_(ACTIVE_FREE_CREDIT_STATUSES),
            )
        )
        if active_request is not None:
            raise ValueError("You already have a free-credit request awaiting review.")

        prior_approved = await self._approved_request_count(user_id=user_id, source=payload.source)
        shared_request = SharedFreeCreditRequestCreate(
            user_id=user_id,
            requested_amount_usd=payload.requested_amount_usd,
            source=payload.source,
            reason=payload.reason,
            linkedin_profile_url=payload.linkedin_profile_url,
            relationship_note=payload.relationship_note,
            intended_use=payload.intended_use,
            evidence_verified=False,
            idempotency_key=payload.idempotency_key,
        )
        policy_decision = evaluate_free_credit_request(
            shared_request,
            self.policy,
            prior_approved_request_count=prior_approved,
        )
        status: FreeCreditRequestStatus = "pending" if policy_decision.requires_admin_review else policy_decision.status
        now = _utcnow()
        request = FreeCreditRequest(
            user_id=user_id,
            requested_amount_usd=payload.requested_amount_usd,
            source=payload.source,
            reason=payload.reason.strip(),
            linkedin_profile_url=_normalized_text(payload.linkedin_profile_url),
            relationship_note=_normalized_text(payload.relationship_note),
            intended_use=_normalized_text(payload.intended_use),
            evidence_verified=False,
            idempotency_key=_normalized_text(payload.idempotency_key),
            status=status,
            decision_note=policy_decision.reason,
            decided_at=now if status in {"approved", "rejected"} else None,
        )
        self.db.add(request)
        await self.db.commit()
        await self.db.refresh(request)

        if status == "approved" and policy_decision.credit_amount_usd is not None:
            return await self._grant_approved_request(
                request_id=request.id,
                admin_user_id="system",
                amount_usd=policy_decision.credit_amount_usd,
                decision_note=policy_decision.reason,
            )
        return _free_credit_summary(request)

    async def list_user_requests(self, *, user_id: str, limit: int = 20) -> list[FreeCreditRequestSummary]:
        result = await self.db.execute(
            select(FreeCreditRequest)
            .where(FreeCreditRequest.user_id == user_id)
            .order_by(FreeCreditRequest.created_at.desc())
            .limit(limit)
        )
        return [_free_credit_summary(row) for row in result.scalars().all()]

    async def list_admin_requests(
        self,
        *,
        status: FreeCreditRequestStatus | None,
        limit: int = 50,
    ) -> list[FreeCreditRequestSummary]:
        statement = select(FreeCreditRequest).order_by(FreeCreditRequest.created_at.desc()).limit(limit)
        if status is not None:
            statement = statement.where(FreeCreditRequest.status == status)
        result = await self.db.execute(statement)
        return [_free_credit_summary(row) for row in result.scalars().all()]

    async def decide_admin_request(
        self,
        *,
        request_id: str,
        admin_user_id: str,
        status: Literal["approved", "rejected", "manual_review_required"],
        decision_note: str,
        credit_amount_usd: float | None,
    ) -> FreeCreditRequestSummary:
        if status == "approved":
            request = await self._request_by_id(request_id)
            amount = round(float(credit_amount_usd or request.requested_amount_usd or 5.0), 8)
            return await self._grant_approved_request(
                request_id=request_id,
                admin_user_id=admin_user_id,
                amount_usd=amount,
                decision_note=decision_note,
            )

        request = await self.db.get(FreeCreditRequest, request_id)
        if request is None:
            raise FileNotFoundError("Free-credit request was not found.")
        request.status = status
        request.decision_note = decision_note.strip()
        request.reviewer_user_id = admin_user_id
        request.decided_amount_usd = None
        request.decided_at = _utcnow() if status == "rejected" else None
        request.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(request)
        return _free_credit_summary(request)

    async def _request_by_id(self, request_id: str) -> FreeCreditRequest:
        request = await self.db.get(FreeCreditRequest, request_id)
        if request is None:
            raise FileNotFoundError("Free-credit request was not found.")
        return request

    async def _approved_request_count(self, *, user_id: str, source: str) -> int:
        return int(
            await self.db.scalar(
                select(func.count(FreeCreditRequest.id)).where(
                    FreeCreditRequest.user_id == user_id,
                    FreeCreditRequest.source == source,
                    FreeCreditRequest.status == "approved",
                )
            )
            or 0
        )

    async def _grant_approved_request(
        self,
        *,
        request_id: str,
        admin_user_id: str,
        amount_usd: float,
        decision_note: str,
    ) -> FreeCreditRequestSummary:
        request = await self.db.get(FreeCreditRequest, request_id)
        if request is None:
            raise FileNotFoundError("Free-credit request was not found.")
        if request.credit_grant_id is not None:
            request.status = "approved"
            request.decision_note = decision_note.strip()
            request.reviewer_user_id = admin_user_id
            request.decided_at = request.decided_at or _utcnow()
            request.updated_at = _utcnow()
            await self.db.commit()
            await self.db.refresh(request)
            return _free_credit_summary(request)

        _, grant = await CreditService(self.db).grant_credit_record(
            request.user_id,
            amount_usd,
            admin_user_id=admin_user_id,
            note=decision_note,
            source="free_credit_request",
            payment_reference=request_id,
        )
        request = await self.db.get(FreeCreditRequest, request_id)
        if request is None:
            raise FileNotFoundError("Free-credit request was not found after credit grant.")
        request.status = "approved"
        request.decided_amount_usd = round(float(amount_usd), 8)
        request.decision_note = decision_note.strip()
        request.reviewer_user_id = admin_user_id
        request.credit_grant_id = grant.id
        request.decided_at = _utcnow()
        request.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(request)
        return _free_credit_summary(request)


def _free_credit_summary(request: FreeCreditRequest) -> FreeCreditRequestSummary:
    return FreeCreditRequestSummary(
        id=request.id,
        user_id=request.user_id,
        requested_amount_usd=round(float(request.requested_amount_usd), 8)
        if request.requested_amount_usd is not None
        else None,
        source=cast(FreeCreditSource, request.source),
        reason=request.reason,
        linkedin_profile_url=request.linkedin_profile_url,
        relationship_note=request.relationship_note,
        intended_use=request.intended_use,
        evidence_verified=request.evidence_verified,
        idempotency_key=request.idempotency_key,
        status=cast(FreeCreditRequestStatus, request.status),
        decided_amount_usd=round(float(request.decided_amount_usd), 8)
        if request.decided_amount_usd is not None
        else None,
        decision_note=request.decision_note,
        reviewer_user_id=request.reviewer_user_id,
        credit_grant_id=request.credit_grant_id,
        created_at=request.created_at,
        updated_at=request.updated_at,
        decided_at=request.decided_at,
    )


def _normalized_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _utcnow() -> datetime:
    return datetime.now(UTC)
