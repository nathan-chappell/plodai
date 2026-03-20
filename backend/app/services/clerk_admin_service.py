from typing import TypedDict

from clerk_backend_api import models
from clerk_backend_api.sdk import Clerk

from backend.app.core.clerk_metadata import (
    CREDIT_FLOOR_METADATA_KEY,
    DEFAULT_CREDIT_FLOOR_USD,
    as_public_metadata,
    has_explicit_credit_floor,
    resolve_credit_floor_usd,
)
from backend.app.core.config import get_settings
from backend.app.models.types import UserRole


class UserSummaryMapping(TypedDict):
    id: str
    email: str | None
    full_name: str | None
    image_url: str | None
    role: UserRole
    is_active: bool
    credit_floor_usd: float
    created_at_ms: int
    last_sign_in_at_ms: int | None


def _client() -> Clerk:
    settings = get_settings()
    if not settings.CLERK_SECRET_KEY:
        raise RuntimeError("CLERK_SECRET_KEY is required for Clerk admin operations.")
    return Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


def _resolve_primary_email(user: models.User) -> str | None:
    if user.primary_email_address_id:
        for email in user.email_addresses:
            if email.id == user.primary_email_address_id:
                return email.email_address
    if user.email_addresses:
        return user.email_addresses[0].email_address
    return None


def _resolve_full_name(user: models.User) -> str | None:
    parts = [part for part in [user.first_name, user.last_name] if part]
    if parts:
        return " ".join(parts)
    return None


def _resolve_role(user: models.User) -> UserRole:
    role = as_public_metadata(user.public_metadata).get("role")
    return "admin" if role == "admin" else "user"


def _resolve_active(user: models.User) -> bool:
    return bool(as_public_metadata(user.public_metadata).get("active") is True)


async def list_users(
    *,
    limit: int,
    offset: int,
    query: str | None = None,
) -> list[models.User]:
    client = _client()
    request: models.GetUserListRequestTypedDict = {
        "limit": limit,
        "offset": offset,
        "order_by": "-created_at",
    }
    normalized_query = query.strip() if query else ""
    if normalized_query:
        request["query"] = normalized_query
    return await client.users.list_async(request=request)


def map_user_summary(user: models.User) -> UserSummaryMapping:
    return {
        "id": user.id,
        "email": _resolve_primary_email(user),
        "full_name": _resolve_full_name(user),
        "image_url": user.image_url,
        "role": _resolve_role(user),
        "is_active": _resolve_active(user),
        "credit_floor_usd": resolve_credit_floor_usd(
            as_public_metadata(user.public_metadata)
        ),
        "created_at_ms": user.created_at,
        "last_sign_in_at_ms": user.last_sign_in_at,
    }


async def set_user_active_state(
    *,
    user_id: str,
    active: bool,
) -> UserSummaryMapping:
    client = _client()
    user = await client.users.get_async(user_id=user_id)
    public_metadata = dict(as_public_metadata(user.public_metadata))
    public_metadata["active"] = active
    if active and not has_explicit_credit_floor(public_metadata):
        public_metadata[CREDIT_FLOOR_METADATA_KEY] = DEFAULT_CREDIT_FLOOR_USD
    updated_user = await client.users.update_async(
        user_id=user_id,
        public_metadata=public_metadata,
    )
    return map_user_summary(updated_user)
