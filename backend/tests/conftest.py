import asyncio

import pytest
from sqlalchemy import inspect

from backend.app.core.config import get_settings
from backend.app.db.session import Base, engine
from backend.app.models.registry import import_models


def _reset_test_schema(sync_conn) -> None:
    inspector = inspect(sync_conn)
    if inspector.get_table_names():
        Base.metadata.drop_all(sync_conn)
    Base.metadata.create_all(sync_conn)


@pytest.fixture(scope="session")
def initialized_db() -> None:
    get_settings()
    import_models()

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(_reset_test_schema)

    asyncio.run(_init())
