from dataclasses import dataclass

from clerk_backend_api.sdk import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions, RequestState
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import get_settings


@dataclass
class ClerkSessionIdentity:
    clerk_user_id: str
    email: str
    full_name: str
    request_state: RequestState


class ClerkAuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()
        self.client = (
            Clerk(bearer_auth=self.settings.CLERK_SECRET_KEY)
            if self.settings.CLERK_SECRET_KEY
            else None
        )

    @property
    def enabled(self) -> bool:
        return self.client is not None

    async def authenticate_bearer_token(
        self, authorization: str | None
    ) -> ClerkSessionIdentity | None:
        if not self.enabled:
            return None
        if not authorization or not authorization.startswith("Bearer "):
            return None

        request_state = await self.client.authenticate_request_async(
            {"headers": {"Authorization": authorization}},
            AuthenticateRequestOptions(
                secret_key=self.settings.CLERK_SECRET_KEY,
                jwt_key=self.settings.CLERK_JWT_KEY,
                authorized_parties=(
                    self.settings.clerk_authorized_parties or None
                ),
                clock_skew_in_ms=self.settings.clerk_clock_skew_ms,
            ),
        )
        if not request_state.is_signed_in or request_state.payload is None:
            return None

        payload = request_state.payload
        clerk_user_id = str(payload.get("sub") or "").strip()
        if not clerk_user_id:
            return None

        email = str(payload.get("email") or "").strip().lower()
        full_name = str(payload.get("name") or "").strip()

        if not email:
          clerk_user = await self.client.users.get_async(user_id=clerk_user_id)
          primary_email = getattr(clerk_user, "primary_email_address", None)
          email = str(getattr(primary_email, "email_address", "") or "").strip().lower()
          full_name = str(getattr(clerk_user, "full_name", "") or "").strip()

        if not email:
            return None

        return ClerkSessionIdentity(
            clerk_user_id=clerk_user_id,
            email=email,
            full_name=full_name,
            request_state=request_state,
        )
