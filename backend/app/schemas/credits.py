from datetime import datetime

from pydantic import BaseModel, Field

from backend.app.models.types import UserRole


class CreditBalanceResponse(BaseModel):
    user_id: str
    current_credit_usd: float
    updated_at: datetime


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
