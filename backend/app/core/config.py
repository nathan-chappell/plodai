from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./report_foundry.db"
    static_dir: str = "./dist"
    openai_max_retries: int = 5
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
