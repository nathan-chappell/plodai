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
    plodai_chat_attachment_max_bytes: int = 10 * 1024 * 1024
    PUBLIC_BASE_URL: str | None = None
    storage_bucket_endpoint: str = "https://t3.storageapi.dev"
    storage_bucket_name: str = "report-foundry-bucket-9n-mxk"
    storage_bucket_access_key_id: str = (
        "tid_MIHyCBnGUWcYKySahNMlhnNWJfCyHwDWKSEgeYycDLpRTSRZFz"
    )
    storage_bucket_secret_access_key: str = Field(init=False)
    storage_bucket_region: str = "auto"
    storage_bucket_url_style: str = "virtual"
    storage_bucket_upload_url_ttl_seconds: int = 15 * 60
    storage_bucket_download_url_ttl_seconds: int = 5 * 60
    clerk_authorized_parties: list[str] = []
    clerk_clock_skew_ms: int = 5000
    USE_COLORLOG: bool = False
    LOG_LEVEL: str = "INFO"

    OPENAI_API_KEY: str = Field(init=False)
    CORS_ORIGINS: list[str] = Field(init=False)
    CLERK_SECRET_KEY: str | None = None
    CLERK_JWT_KEY: str | None = None

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
