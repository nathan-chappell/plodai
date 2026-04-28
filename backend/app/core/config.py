from functools import lru_cache
from pathlib import Path
import re
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATABASE_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./ai_portfolio.db"
    database_schema_mode: Literal["create_all", "migrations"] = "migrations"
    database_app_schema: str = "plodai"
    database_shared_schema: str = "public"
    static_dir: str = "./dist"
    openai_max_retries: int = 5
    plodai_chat_attachment_max_bytes: int = 10 * 1024 * 1024
    PUBLIC_BASE_URL: str | None = None
    storage_bucket_endpoint: str = "https://t3.storageapi.dev"
    storage_bucket_name: str = "report-foundry-bucket-9n-mxk"
    storage_bucket_access_key_id: str = (
        "tid_MIHyCBnGUWcYKySahNMlhnNWJfCyHwDWKSEgeYycDLpRTSRZFz"
    )
    storage_bucket_secret_access_key: str = Field(init=False)
    storage_bucket_region: str = "auto"
    storage_bucket_url_style: str = "path"
    storage_bucket_upload_url_ttl_seconds: int = 15 * 60
    storage_bucket_download_url_ttl_seconds: int = 5 * 60
    clerk_authorized_parties: list[str] = []
    clerk_clock_skew_ms: int = 5000
    paypal_recipient_email: str | None = None
    paypal_payment_url: AnyHttpUrl | None = None
    paypal_min_payment_usd: float = 5.0
    paypal_max_payment_usd: float = 250.0
    USE_COLORLOG: bool = False
    LOG_LEVEL: str = "INFO"

    OPENAI_API_KEY: str = Field(init=False)
    CORS_ORIGINS: list[str] = Field(init=False)
    CLERK_SECRET_KEY: str | None = None
    CLERK_JWT_KEY: str | None = None

    @field_validator("database_app_schema", "database_shared_schema")
    @classmethod
    def validate_database_identifier(cls, value: str) -> str:
        cleaned_value = value.strip()
        if DATABASE_IDENTIFIER_PATTERN.fullmatch(cleaned_value) is None:
            raise ValueError(
                "database schema names must be valid PostgreSQL identifiers"
            )
        return cleaned_value

    @field_validator("USE_COLORLOG", mode="before")
    @classmethod
    def normalize_quoted_bool(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().strip("\"'")
        return value

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url

    @property
    def sync_database_url(self) -> str:
        database_url = self.async_database_url
        if database_url.startswith("postgresql+asyncpg://"):
            return database_url.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
        if database_url.startswith("sqlite+aiosqlite://"):
            return database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
        return database_url

    @property
    def database_search_path(self) -> tuple[str, ...]:
        schema_names = [self.database_app_schema, self.database_shared_schema, "public"]
        return tuple(dict.fromkeys(schema_names))

    @property
    def uses_postgresql(self) -> bool:
        return self.sync_database_url.startswith("postgresql")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def summarize_database_url_for_log(database_url: str) -> str:
    parsed_url = urlsplit(database_url)
    if not parsed_url.scheme or not parsed_url.netloc or "@" not in parsed_url.netloc:
        return database_url

    _, host = parsed_url.netloc.rsplit("@", 1)
    redacted_netloc = f"<credentials>@{host}"
    return urlunsplit(
        (
            parsed_url.scheme,
            redacted_netloc,
            parsed_url.path,
            "",
            "",
        )
    )


def resolve_public_base_url(
    fallback_base_url: str | None = None,
    *,
    settings: Settings | None = None,
) -> str:
    resolved_settings = settings or get_settings()
    configured_base_url = (
        resolved_settings.PUBLIC_BASE_URL.strip()
        if isinstance(resolved_settings.PUBLIC_BASE_URL, str)
        else ""
    )
    if configured_base_url:
        return configured_base_url.rstrip("/")

    if isinstance(fallback_base_url, str) and fallback_base_url.strip():
        return fallback_base_url.rstrip("/")

    return "http://localhost"
