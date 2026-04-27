import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass

from backend.app.core.config import PROJECT_ROOT, get_settings


class Base(AsyncAttrs, MappedAsDataclass, DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(settings.async_database_url, future=True)
AsyncSessionLocal = async_sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False
)


async def get_db():
    async with AsyncSessionLocal() as db:
        yield db


def ensure_database_directory(database_url: str) -> None:
    parsed_url = make_url(database_url)
    if parsed_url.get_backend_name() != "sqlite":
        return
    database_name = parsed_url.database
    if database_name is None or database_name in {"", ":memory:"}:
        return
    database_path = Path(database_name)
    if not database_path.is_absolute():
        database_path = (PROJECT_ROOT / database_path).resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)


def _upgrade_to_head() -> None:
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", settings.sync_database_url)
    command.upgrade(config, "head")


async def ensure_database_ready() -> None:
    from backend.app.models.registry import import_models

    import_models()
    ensure_database_directory(settings.sync_database_url)
    if settings.database_schema_mode == "migrations":
        await asyncio.to_thread(_upgrade_to_head)
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
