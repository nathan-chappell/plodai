import asyncio

import pytest

from backend.app.db.startup_retry import (
    is_postgresql_starting_up_error,
    run_async_with_postgresql_startup_retries,
    run_with_postgresql_startup_retries,
)

pytestmark = pytest.mark.no_db


def test_detects_postgresql_starting_up_message_in_exception_chain() -> None:
    wrapped_error = RuntimeError("SQLAlchemy wrapped the DBAPI error")
    wrapped_error.__cause__ = RuntimeError(
        "FATAL: the database system is starting up"
    )

    assert is_postgresql_starting_up_error(wrapped_error)


def test_detects_postgresql_starting_up_message_in_sqlalchemy_orig() -> None:
    wrapped_error = RuntimeError("SQLAlchemy wrapped the DBAPI error")
    wrapped_error.orig = RuntimeError("FATAL: the database is starting up")

    assert is_postgresql_starting_up_error(wrapped_error)


def test_sync_retry_returns_after_postgresql_startup_error_clears() -> None:
    attempts = 0

    def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("FATAL: the database system is starting up")
        return "ready"

    result = run_with_postgresql_startup_retries(
        operation,
        operation_name="test.sync",
        max_attempts=5,
        delay_seconds=0,
    )

    assert result == "ready"
    assert attempts == 3


def test_sync_retry_keeps_unrelated_database_errors_fail_fast() -> None:
    attempts = 0

    def operation() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("FATAL: password authentication failed")

    with pytest.raises(RuntimeError, match="password authentication failed"):
        run_with_postgresql_startup_retries(
            operation,
            operation_name="test.sync",
            max_attempts=5,
            delay_seconds=0,
        )

    assert attempts == 1


def test_sync_retry_stops_at_bounded_attempts() -> None:
    attempts = 0

    def operation() -> None:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("FATAL: the database is starting up")

    with pytest.raises(RuntimeError, match="database is starting up"):
        run_with_postgresql_startup_retries(
            operation,
            operation_name="test.sync",
            max_attempts=2,
            delay_seconds=0,
        )

    assert attempts == 2


def test_async_retry_returns_after_postgresql_startup_error_clears() -> None:
    attempts = 0

    async def scenario() -> str:
        async def operation() -> str:
            nonlocal attempts
            attempts += 1
            if attempts < 2:
                raise RuntimeError("FATAL: the database system is starting up")
            return "ready"

        return await run_async_with_postgresql_startup_retries(
            operation,
            operation_name="test.async",
            max_attempts=3,
            delay_seconds=0,
        )

    assert asyncio.run(scenario()) == "ready"
    assert attempts == 2
