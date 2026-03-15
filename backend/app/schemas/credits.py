from datetime import datetime

from pydantic import BaseModel, Field


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
    grant_welcome_credit: bool = False


class AdminSetUserActiveResponse(BaseModel):
    user_id: str
    is_active: bool
    current_credit_usd: float
