import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from backend.app.core.logging import get_logger, log_event

POSTGRESQL_STARTING_UP_MESSAGES = (
    "database is starting up",
    "database system is starting up",
)

T = TypeVar("T")

logger = get_logger("db.startup_retry")


def is_postgresql_starting_up_error(error: BaseException) -> bool:
    seen_exception_ids: set[int] = set()
    pending_errors: list[BaseException] = [error]
    while pending_errors:
        current_error = pending_errors.pop()
        if id(current_error) in seen_exception_ids:
            continue
        seen_exception_ids.add(id(current_error))
        normalized_message = str(current_error).lower()
        if any(
            message_fragment in normalized_message
            for message_fragment in POSTGRESQL_STARTING_UP_MESSAGES
        ):
            return True
        cause = current_error.__cause__
        if cause is not None:
            pending_errors.append(cause)
        context = current_error.__context__
        if context is not None:
            pending_errors.append(context)
        original_error = getattr(current_error, "orig", None)
        if isinstance(original_error, BaseException):
            pending_errors.append(original_error)
    return False


def run_with_postgresql_startup_retries(
    operation: Callable[[], T],
    *,
    operation_name: str,
    max_attempts: int,
    delay_seconds: float,
) -> T:
    bounded_attempts = max(1, max_attempts)
    for attempt_number in range(1, bounded_attempts + 1):
        try:
            return operation()
        except Exception as exc:
            if (
                not is_postgresql_starting_up_error(exc)
                or attempt_number == bounded_attempts
            ):
                raise
            log_event(
                logger,
                logging.WARNING,
                "database.startup_retry",
                operation=operation_name,
                attempt=attempt_number,
                max_attempts=bounded_attempts,
                delay_seconds=delay_seconds,
            )
            if delay_seconds > 0:
                time.sleep(delay_seconds)
    raise RuntimeError("unreachable PostgreSQL startup retry state")


async def run_async_with_postgresql_startup_retries(
    operation: Callable[[], Awaitable[T]],
    *,
    operation_name: str,
    max_attempts: int,
    delay_seconds: float,
) -> T:
    bounded_attempts = max(1, max_attempts)
    for attempt_number in range(1, bounded_attempts + 1):
        try:
            return await operation()
        except Exception as exc:
            if (
                not is_postgresql_starting_up_error(exc)
                or attempt_number == bounded_attempts
            ):
                raise
            log_event(
                logger,
                logging.WARNING,
                "database.startup_retry",
                operation=operation_name,
                attempt=attempt_number,
                max_attempts=bounded_attempts,
                delay_seconds=delay_seconds,
            )
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)
    raise RuntimeError("unreachable PostgreSQL startup retry state")
