from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./report_foundry.db"
    auth_salt: str = "report-foundry-auth"
    auth_token_max_age_seconds: int = 60 * 60 * 12
    bootstrap_admin_email: str = "admin@example.com"
    bootstrap_admin_name: str = "Built-in Admin"
    static_dir: str = "./backend/app/static"

    BOOTSTRAP_ADMIN_PASSWORD: str = Field(init=False)
    AUTH_SECRET_KEY: str = Field(init=False)
    OPENAI_API_KEY: str = Field(init=False)
    CORS_ORIGINS: list[str] = Field(init=False)

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url

    @property
    def static_path(self) -> Path:
        configured = Path(self.static_dir)
        if configured.is_absolute():
            return configured
        return (ROOT_DIR / configured).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
