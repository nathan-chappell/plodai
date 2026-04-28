import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass

from backend.app.core.config import PROJECT_ROOT, get_settings
from backend.app.db.schemas import APP_SCHEMA_KEY, SHARED_SCHEMA_KEY


class Base(AsyncAttrs, MappedAsDataclass, DeclarativeBase):
    pass


settings = get_settings()


def _schema_translate_map() -> dict[str, str | None]:
    if settings.uses_postgresql:
        return {
            APP_SCHEMA_KEY: settings.database_app_schema,
            SHARED_SCHEMA_KEY: settings.database_shared_schema,
        }
    return {APP_SCHEMA_KEY: None, SHARED_SCHEMA_KEY: None}


engine = create_async_engine(
    settings.async_database_url,
    execution_options={"schema_translate_map": _schema_translate_map()},
    future=True,
)
AsyncSessionLocal = async_sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False
)


@event.listens_for(engine.sync_engine, "connect")
def _configure_postgresql_schema_search_path(dbapi_connection, _connection_record) -> None:
    if not settings.uses_postgresql:
        return

    async def _configure_connection(driver_connection) -> None:
        schema_statements = [
            f'CREATE SCHEMA IF NOT EXISTS "{settings.database_app_schema}"'
        ]
        if settings.database_shared_schema != "public":
            schema_statements.append(
                f'CREATE SCHEMA IF NOT EXISTS "{settings.database_shared_schema}"'
            )
        search_path = ", ".join(
            f'"{schema_name}"' for schema_name in settings.database_search_path
        )
        schema_statements.append(f"SET search_path TO {search_path}")
        for statement in schema_statements:
            await driver_connection.execute(statement)

    dbapi_connection.run_async(_configure_connection)


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
