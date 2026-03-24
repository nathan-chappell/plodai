from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./ai_portfolio.db"
    static_dir: str = "./dist"
    openai_max_retries: int = 5
    stored_file_default_expiry_seconds: int = 24 * 60 * 60
    plodai_chat_attachment_max_bytes: int = 10 * 1024 * 1024
    chat_attachment_max_model_bytes: int = 32 * 1024 * 1024
    document_thread_max_bytes: int = 100 * 1024 * 1024
    document_preview_max_pages: int = 12
    PUBLIC_BASE_URL: str | None = None
    clerk_authorized_parties: list[str] = []
    clerk_clock_skew_ms: int = 5000
    USE_COLORLOG: bool = False
    LOG_LEVEL: str = "INFO"

    OPENAI_API_KEY: str = Field(init=False)
    CORS_ORIGINS: list[str] = Field(init=False)
    CLERK_SECRET_KEY: str | None = None
    CLERK_JWT_KEY: str | None = None
    ENABLE_DEV_AUTH_BEARER: bool = False

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()


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
