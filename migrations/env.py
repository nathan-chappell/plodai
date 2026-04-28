from __future__ import annotations

import logging
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, make_url, pool

from backend.app.core.config import Settings
from backend.app.db.session import Base
from backend.app.db.schemas import APP_SCHEMA_KEY, SHARED_SCHEMA_KEY
from backend.app.models.registry import import_models

config = context.config

if config.config_file_name is not None and not logging.getLogger().handlers:
    fileConfig(config.config_file_name)

import_models()
target_metadata = Base.metadata


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

        context.configure(
            connection=connection.execution_options(
                schema_translate_map=_schema_translate_map(
                    settings,
                    uses_postgresql=uses_postgresql,
                )
            ),
            target_metadata=target_metadata,
            include_schemas=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
