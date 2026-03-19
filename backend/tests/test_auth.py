import asyncio

from fastapi.security import HTTPAuthorizationCredentials

from backend.app.core.auth import DEFAULT_DEV_AUTH_BEARER_TOKEN, _require_clerk_user
from backend.app.core.config import Settings


def test_require_clerk_user_accepts_default_dev_bearer_token() -> None:
    settings = Settings(
        _env_file=None,
        OPENAI_API_KEY="test-openai-key",
        CORS_ORIGINS=["http://localhost:5173"],
        ENABLE_DEV_AUTH_BEARER=True,
        CLERK_SECRET_KEY=None,
    )
    user = asyncio.run(
        _require_clerk_user(
            HTTPAuthorizationCredentials(
                scheme="Bearer",
                credentials=DEFAULT_DEV_AUTH_BEARER_TOKEN,
            ),
            settings=settings,
        )
    )

    assert user.id == "local-dev-admin"
    assert user.email == "dev@local.test"
    assert user.role == "admin"
    assert user.is_active is True


def test_require_clerk_user_rejects_dev_bearer_when_bypass_disabled() -> None:
    settings = Settings(
        _env_file=None,
        OPENAI_API_KEY="test-openai-key",
        CORS_ORIGINS=["http://localhost:5173"],
        ENABLE_DEV_AUTH_BEARER=False,
        CLERK_SECRET_KEY=None,
    )
    try:
        asyncio.run(
            _require_clerk_user(
                HTTPAuthorizationCredentials(
                    scheme="Bearer",
                    credentials=DEFAULT_DEV_AUTH_BEARER_TOKEN,
                ),
                settings=settings,
            )
        )
    except Exception as error:
        assert getattr(error, "status_code", None) == 503
        assert "Clerk auth is not configured" in getattr(error, "detail", "")
    else:
        raise AssertionError("Expected the dev bearer bypass to stay disabled.")
