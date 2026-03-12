from typing import Literal

from pydantic import BaseModel, EmailStr

from backend.app.models.types import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""
    role: UserRole = "user"
    is_active: bool = True


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool


class UserListResponse(BaseModel):
    users: list[UserResponse]


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse
