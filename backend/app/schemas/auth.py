from pydantic import BaseModel, EmailStr

from backend.app.models.types import UserRole


class UserResponse(BaseModel):
    id: str
    email: EmailStr | None
    full_name: str | None
    role: UserRole
    is_active: bool
    current_credit_usd: float
    credit_floor_usd: float
