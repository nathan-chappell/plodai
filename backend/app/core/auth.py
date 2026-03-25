from dataclasses import dataclass
from typing import Mapping

from clerk_backend_api.sdk import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.app.core.config import Settings, get_settings
from backend.app.core.clerk_metadata import (
    as_public_metadata,
    resolve_credit_floor_usd,
)
from backend.app.db.session import get_db
from backend.app.models.credit import UserCreditBalance
from backend.app.models.types import UserRole
from sqlalchemy.ext.asyncio import AsyncSession


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None
    full_name: str | None
    role: UserRole
    is_active: bool
    credit_floor_usd: float


@dataclass(frozen=True)
class ClerkRequest:
    headers: Mapping[str, str]

async def _require_clerk_user(
    credentials: HTTPAuthorizationCredentials | None,
    *,
    settings: Settings | None = None,
) -> AuthenticatedUser:
    resolved_settings = settings if settings is not None else get_settings()

    if not resolved_settings.CLERK_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Clerk auth is not configured on the server. Set CLERK_SECRET_KEY in the backend environment and restart the API.",
        )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Clerk bearer token.",
        )

    client = Clerk(bearer_auth=resolved_settings.CLERK_SECRET_KEY)
    request_state = await client.authenticate_request_async(
        ClerkRequest(
            headers={"Authorization": f"{credentials.scheme} {credentials.credentials}"}
        ),
        AuthenticateRequestOptions(
            secret_key=resolved_settings.CLERK_SECRET_KEY,
            jwt_key=resolved_settings.CLERK_JWT_KEY,
            authorized_parties=resolved_settings.clerk_authorized_parties or None,
            clock_skew_in_ms=resolved_settings.clerk_clock_skew_ms,
        ),
    )
    if not request_state.is_signed_in or request_state.payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Clerk session.",
        )

    payload = request_state.payload
    clerk_user_id = str(payload.get("sub") or "").strip()
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk session did not include a usable identity.",
        )

    clerk_user = await client.users.get_async(user_id=clerk_user_id)
    email = str(payload.get("email") or "").strip().lower() or None
    if not email and clerk_user.primary_email_address_id:
        for email_address in clerk_user.email_addresses:
            if email_address.id == clerk_user.primary_email_address_id:
                email = email_address.email_address.strip().lower() or None
                break
    if not email and clerk_user.email_addresses:
        email = clerk_user.email_addresses[0].email_address.strip().lower() or None
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk session did not include a usable email address.",
        )

    public_metadata = as_public_metadata(clerk_user.public_metadata)

    role_value = public_metadata.get("role")
    role: UserRole = "admin" if role_value == "admin" else "user"

    active_value = public_metadata.get("active")
    is_active = active_value is True
    credit_floor_usd = resolve_credit_floor_usd(public_metadata)
    if not is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Clerk account is not active for the app.",
        )

    full_name = None
    if clerk_user.first_name or clerk_user.last_name:
        full_name = (
            f"{clerk_user.first_name or ''} {clerk_user.last_name or ''}".strip()
            or None
        )
    if not full_name:
        full_name = str(payload.get("name") or "").strip() or None

    return AuthenticatedUser(
        id=clerk_user_id,
        email=email,
        full_name=full_name,
        role=role,
        is_active=True,
        credit_floor_usd=credit_floor_usd,
    )


async def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    return await _require_clerk_user(credentials)


async def require_admin_user(
    user: AuthenticatedUser = Depends(require_current_user),
) -> AuthenticatedUser:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user


async def require_paid_user(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    if user.role == "admin":
        return user

    balance = await db.get(UserCreditBalance, user.id)
    current_credit_usd = (
        float(balance.current_credit_usd) if balance is not None else 0.0
    )
    if current_credit_usd <= user.credit_floor_usd:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Credit limit reached. Add credit to continue using PlodAI.",
        )
    return user
