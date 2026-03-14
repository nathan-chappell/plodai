from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_db
from backend.app.models.types import UserRole
from backend.app.services.auth_service import AuthService
from backend.app.services.clerk_auth_service import ClerkAuthService


@dataclass
class AuthenticatedUser:
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    clerk_user_id: str | None = None


async def require_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    clerk_identity = await ClerkAuthService(db).authenticate_bearer_token(authorization)
    if clerk_identity is not None:
        user = await AuthService(db).get_active_user_by_email(clerk_identity.email)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authenticated with Clerk, but this account is not approved for the app yet.",
            )
        return AuthenticatedUser(
            id=user.id,
            email=user.email,
            full_name=user.full_name or clerk_identity.full_name or user.email,
            role=user.role,
            is_active=user.is_active,
            clerk_user_id=clerk_identity.clerk_user_id,
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    token = authorization.removeprefix("Bearer ").strip()
    user = await AuthService(db).authenticate_token(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    return AuthenticatedUser(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
    )


async def require_admin_user(
    user: AuthenticatedUser = Depends(require_current_user),
) -> AuthenticatedUser:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user
