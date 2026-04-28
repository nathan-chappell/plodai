import asyncio
from collections.abc import Generator

import pytest
from sqlalchemy import inspect

from backend.app.core.config import get_settings
from backend.app.db.session import Base, engine
from backend.app.db.startup_retry import run_async_with_postgresql_startup_retries
from backend.app.models.registry import import_models


def _reset_test_schema(sync_conn) -> None:
    inspector = inspect(sync_conn)
    if inspector.get_table_names():
        Base.metadata.drop_all(sync_conn)
    Base.metadata.create_all(sync_conn)


@pytest.fixture(autouse=True)
def initialized_db(request: pytest.FixtureRequest) -> Generator[None]:
    if request.node.get_closest_marker("no_db") is not None:
        yield
        return

    settings = get_settings()
    import_models()

    async def _init() -> None:
        async def _reset() -> None:
            async with engine.begin() as conn:
                await conn.run_sync(_reset_test_schema)

        await run_async_with_postgresql_startup_retries(
            _reset,
            operation_name="test.database.reset",
            max_attempts=settings.database_startup_retry_attempts,
            delay_seconds=settings.database_startup_retry_delay_seconds,
        )
        await engine.dispose()

    asyncio.run(_init())
    yield

    async def _dispose() -> None:
        await engine.dispose()

    asyncio.run(_dispose())
