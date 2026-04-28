from __future__ import annotations

import logging
from logging.config import fileConfig
from pathlib import Path
import re

from alembic import context
from sqlalchemy import engine_from_config, make_url, pool, text
from sqlalchemy.engine import Engine

from backend.app.core.config import Settings
from backend.app.db.session import Base
from backend.app.db.schemas import APP_SCHEMA_KEY, SHARED_SCHEMA_KEY
from backend.app.db.startup_retry import run_with_postgresql_startup_retries
from backend.app.models.registry import import_models

config = context.config

if config.config_file_name is not None and not logging.getLogger().handlers:
    fileConfig(config.config_file_name)

import_models()
target_metadata = Base.metadata
REVISION_PATTERN = re.compile(r'^revision\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)


def _database_url() -> str:
    configured_url = config.get_main_option("sqlalchemy.url")
    if configured_url and configured_url != "driver://user:pass@localhost/dbname":
        return configured_url
    return Settings().sync_database_url


def _schema_translate_map(
    settings: Settings,
    *,
    uses_postgresql: bool,
) -> dict[str, str | None]:
    if uses_postgresql:
        return {
            APP_SCHEMA_KEY: settings.database_app_schema,
            SHARED_SCHEMA_KEY: settings.database_shared_schema,
        }
    return {APP_SCHEMA_KEY: None, SHARED_SCHEMA_KEY: None}


def _version_table_schema(
    settings: Settings,
    *,
    uses_postgresql: bool,
) -> str | None:
    if uses_postgresql:
        return settings.database_app_schema
    return None


def _quote_identifier(identifier: str) -> str:
    escaped_identifier = identifier.replace('"', '""')
    return f'"{escaped_identifier}"'


def _known_revision_ids() -> set[str]:
    versions_dir = Path(__file__).parent / "versions"
    revision_ids: set[str] = set()
    for migration_path in versions_dir.glob("*.py"):
        match = REVISION_PATTERN.search(migration_path.read_text(encoding="utf-8"))
        if match is not None:
            revision_ids.add(match.group(1))
    return revision_ids


def _app_table_names() -> set[str]:
    return {
        table.name
        for table in target_metadata.tables.values()
        if table.schema == APP_SCHEMA_KEY
    }


def _table_exists(connection, *, schema_name: str, table_name: str) -> bool:
    return bool(
        connection.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = :schema_name
                      AND table_name = :table_name
                )
                """
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).scalar()
    )


def _move_legacy_public_app_tables(connection, settings: Settings) -> None:
    if settings.database_app_schema == "public":
        return

    app_schema = _quote_identifier(settings.database_app_schema)
    for table_name in sorted(_app_table_names()):
        if _table_exists(
            connection,
            schema_name=settings.database_app_schema,
            table_name=table_name,
        ):
            continue
        if not _table_exists(connection, schema_name="public", table_name=table_name):
            continue
        connection.execute(
            text(f"ALTER TABLE public.{_quote_identifier(table_name)} SET SCHEMA {app_schema}")
        )


def _copy_legacy_public_version_table(connection, settings: Settings) -> None:
    if settings.database_app_schema == "public":
        return
    if _table_exists(
        connection,
        schema_name=settings.database_app_schema,
        table_name="alembic_version",
    ):
        return
    if not _table_exists(connection, schema_name="public", table_name="alembic_version"):
        return
    app_table_names = _app_table_names()
    if app_table_names and any(
        not _table_exists(
            connection,
            schema_name=settings.database_app_schema,
            table_name=table_name,
        )
        for table_name in app_table_names
    ):
        return

    legacy_version = connection.execute(
        text("SELECT version_num FROM public.alembic_version LIMIT 1")
    ).scalar()
    if not isinstance(legacy_version, str) or legacy_version not in _known_revision_ids():
        return

    app_schema = _quote_identifier(settings.database_app_schema)
    connection.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {app_schema}.alembic_version (
                version_num VARCHAR(32) NOT NULL,
                CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
            )
            """
        )
    )
    connection.execute(
        text(f"INSERT INTO {app_schema}.alembic_version (version_num) VALUES (:version_num)"),
        {"version_num": legacy_version},
    )


def run_migrations_offline() -> None:
    settings = Settings()
    database_url = _database_url()
    uses_postgresql = make_url(database_url).get_backend_name() == "postgresql"
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        schema_translate_map=_schema_translate_map(
            settings,
            uses_postgresql=uses_postgresql,
        ),
        version_table_schema=_version_table_schema(
            settings,
            uses_postgresql=uses_postgresql,
        ),
    )

    with context.begin_transaction():
        context.run_migrations()


def _run_migrations_online_once(settings: Settings, connectable: Engine) -> None:
    with connectable.connect() as connection:
        uses_postgresql = connection.dialect.name == "postgresql"
        if uses_postgresql:
            connection.exec_driver_sql(
                f'CREATE SCHEMA IF NOT EXISTS "{settings.database_app_schema}"'
            )
            if settings.database_shared_schema != "public":
                connection.exec_driver_sql(
                    f'CREATE SCHEMA IF NOT EXISTS "{settings.database_shared_schema}"'
                )
            search_path = ", ".join(
                f'"{schema_name}"' for schema_name in settings.database_search_path
            )
            connection.exec_driver_sql(f"SET search_path TO {search_path}")
            _move_legacy_public_app_tables(connection, settings)
            _copy_legacy_public_version_table(connection, settings)
            connection.commit()

        context.configure(
            connection=connection.execution_options(
                schema_translate_map=_schema_translate_map(
                    settings,
                    uses_postgresql=uses_postgresql,
                )
            ),
            target_metadata=target_metadata,
            include_schemas=True,
            version_table_schema=_version_table_schema(
                settings,
                uses_postgresql=uses_postgresql,
            ),
        )
        with context.begin_transaction():
            context.run_migrations()


def run_migrations_online() -> None:
    settings = Settings()
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    run_with_postgresql_startup_retries(
        lambda: _run_migrations_online_once(settings, connectable),
        operation_name="alembic.upgrade",
        max_attempts=settings.database_startup_retry_attempts,
        delay_seconds=settings.database_startup_retry_delay_seconds,
    )


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
