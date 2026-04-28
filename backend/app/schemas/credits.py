from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.app.models.types import UserRole

FreeCreditRequestStatus = Literal["pending", "approved", "rejected", "manual_review_required", "expired"]
FreeCreditSource = Literal["general", "linkedin_connection", "beta_tester", "manual_admin"]
PaymentAttemptStatus = Literal[
    "pending_payment",
    "temporarily_approved",
    "confirmed_paid",
    "rejected_payment",
    "expired_temporary_access",
    "manual_review_required",
]


class AdminGrantCreditRequest(BaseModel):
    user_id: str = Field(min_length=1)
    credit_amount_usd: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class AdminGrantCreditResponse(BaseModel):
    user_id: str
    current_credit_usd: float


class AdminSetUserActiveRequest(BaseModel):
    user_id: str = Field(min_length=1)
    active: bool


class AdminSetUserActiveResponse(BaseModel):
    user_id: str
    is_active: bool
    current_credit_usd: float
    credit_floor_usd: float


class AdminUserSummary(BaseModel):
    id: str
    email: str | None
    full_name: str | None
    image_url: str | None = None
    role: UserRole
    is_active: bool
    current_credit_usd: float
    credit_floor_usd: float
    created_at_ms: int
    last_sign_in_at_ms: int | None


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    limit: int
    offset: int
    has_more: bool
    query: str | None = None


class PaymentIntegrationResponse(BaseModel):
    provider: str
    checkout_enabled: bool
    receipt_upload_enabled: bool
    reason: str | None = None
    paypal_recipient_email: str | None = None
    paypal_payment_url: str | None = None
    min_payment_usd: float
    max_payment_usd: float


class PayPalPaymentAttemptCreateRequest(BaseModel):
    expected_amount_usd: float = Field(gt=0)


class PaymentAttemptSummary(BaseModel):
    id: str
    user_id: str
    provider: str
    expected_amount_usd: float
    expected_currency: str
    reference_code: str
    status: PaymentAttemptStatus
    temporary_access_expires_at: datetime | None = None
    provider_reference: str | None = None
    credit_grant_id: str | None = None
    receipt_filename: str | None = None
    review_reason: str | None = None
    decision_note: str | None = None
    created_at: datetime
    updated_at: datetime


class PaymentAttemptListResponse(BaseModel):
    attempts: list[PaymentAttemptSummary] = Field(default_factory=list)


class AdminPaymentAttemptDecisionRequest(BaseModel):
    attempt_id: str = Field(min_length=1)
    status: Literal["confirmed_paid", "rejected_payment", "manual_review_required"]
    decision_note: str = Field(min_length=1, max_length=500)
    credit_amount_usd: float | None = Field(default=None, gt=0)
    provider_reference: str | None = Field(default=None, max_length=255)


class FreeCreditRequestCreate(BaseModel):
    requested_amount_usd: float | None = Field(default=None, gt=0)
    source: FreeCreditSource = "general"
    reason: str = Field(min_length=1, max_length=1000)
    linkedin_profile_url: str | None = Field(default=None, max_length=2048)
    relationship_note: str | None = Field(default=None, max_length=1000)
    intended_use: str | None = Field(default=None, max_length=1000)
    idempotency_key: str | None = Field(default=None, max_length=255)


class FreeCreditRequestSummary(BaseModel):
    id: str
    user_id: str
    requested_amount_usd: float | None = None
    source: FreeCreditSource
    reason: str
    linkedin_profile_url: str | None = None
    relationship_note: str | None = None
    intended_use: str | None = None
    evidence_verified: bool = False
    idempotency_key: str | None = None
    status: FreeCreditRequestStatus
    decided_amount_usd: float | None = None
    decision_note: str | None = None
    reviewer_user_id: str | None = None
    credit_grant_id: str | None = None
    created_at: datetime
    updated_at: datetime
    decided_at: datetime | None = None


class FreeCreditRequestListResponse(BaseModel):
    requests: list[FreeCreditRequestSummary] = Field(default_factory=list)


class AdminFreeCreditDecisionRequest(BaseModel):
    request_id: str = Field(min_length=1)
    status: Literal["approved", "rejected", "manual_review_required"]
    credit_amount_usd: float | None = Field(default=None, gt=0)
    decision_note: str = Field(min_length=1, max_length=500)
