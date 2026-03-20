import asyncio

import pytest

from backend.app.core.config import get_settings
from backend.app.db.session import Base, engine
from backend.app.models.registry import import_models


@pytest.fixture(scope="session")
def initialized_db() -> None:
    get_settings()
    import_models()

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
