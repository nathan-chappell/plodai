import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from backend.app.core.auth import (
    DEFAULT_DEV_AUTH_BEARER_TOKEN,
    AuthenticatedUser,
    _require_clerk_user,
    require_paid_user,
)
from backend.app.core.clerk_metadata import (
    DEFAULT_CREDIT_FLOOR_USD,
    resolve_credit_floor_usd,
)
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
    assert user.credit_floor_usd == DEFAULT_CREDIT_FLOOR_USD


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


def test_resolve_credit_floor_usd_defaults_when_metadata_is_missing_or_invalid() -> None:
    assert resolve_credit_floor_usd(None) == DEFAULT_CREDIT_FLOOR_USD
    assert resolve_credit_floor_usd({}) == DEFAULT_CREDIT_FLOOR_USD
    assert resolve_credit_floor_usd({"credit_floor_usd": ""}) == DEFAULT_CREDIT_FLOOR_USD
    assert resolve_credit_floor_usd({"credit_floor_usd": "wat"}) == DEFAULT_CREDIT_FLOOR_USD


def test_resolve_credit_floor_usd_accepts_numeric_values() -> None:
    assert resolve_credit_floor_usd({"credit_floor_usd": -2}) == -2.0
    assert resolve_credit_floor_usd({"credit_floor_usd": "-0.25"}) == -0.25
    assert resolve_credit_floor_usd({"credit_floor_usd": 1.234567891}) == 1.23456789


class _FakeAsyncSession:
    def __init__(self, balance_amount: float | None):
        self.balance_amount = balance_amount

    async def get(self, _model: object, _user_id: str) -> object | None:
        if self.balance_amount is None:
            return None
        return SimpleNamespace(current_credit_usd=self.balance_amount)


class _ExplodingAsyncSession:
    async def get(self, _model: object, _user_id: str) -> object | None:
        raise AssertionError("Admin users should bypass the balance lookup.")


def _build_user(
    *,
    credit_floor_usd: float,
    role: str = "user",
) -> AuthenticatedUser:
    return AuthenticatedUser(
        id="user_123",
        email="user@example.com",
        full_name="Example User",
        role=role,
        is_active=True,
        credit_floor_usd=credit_floor_usd,
    )


def test_require_paid_user_allows_new_user_until_floor_is_reached() -> None:
    user = _build_user(credit_floor_usd=DEFAULT_CREDIT_FLOOR_USD)

    accepted = asyncio.run(
        require_paid_user(
            user=user,
            db=_FakeAsyncSession(balance_amount=None),
        )
    )

    assert accepted is user


def test_require_paid_user_rejects_user_once_balance_hits_floor() -> None:
    user = _build_user(credit_floor_usd=-1.0)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            require_paid_user(
                user=user,
                db=_FakeAsyncSession(balance_amount=-1.0),
            )
        )

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail == "Credit limit reached. Add credit to continue using the workspace."


def test_require_paid_user_skips_credit_gate_for_admins() -> None:
    admin_user = _build_user(credit_floor_usd=-1.0, role="admin")

    accepted = asyncio.run(
        require_paid_user(
            user=admin_user,
            db=_ExplodingAsyncSession(),
        )
    )

    assert accepted is admin_user
