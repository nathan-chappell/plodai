from clerk_backend_api.sdk import Clerk

from backend.app.core.config import get_settings


def _client() -> Clerk:
    settings = get_settings()
    if not settings.CLERK_SECRET_KEY:
        raise RuntimeError("CLERK_SECRET_KEY is required for Clerk admin operations.")
    return Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


async def set_user_active_state(*, user_id: str, active: bool) -> bool:
    client = _client()
    user = await client.users.get_async(user_id=user_id)
    public_metadata = dict(user.public_metadata or {})
    public_metadata["active"] = active
    updated_user = await client.users.update_async(
        user_id=user_id,
        public_metadata=public_metadata,
    )
    return bool((updated_user.public_metadata or {}).get("active") is True)
