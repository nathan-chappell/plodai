from pathlib import Path
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False
    )

    database_url: str = "sqlite:///./report_foundry.db"
    auth_secret_key: str = "replace-me"
    auth_salt: str = "report-foundry-auth"
    auth_token_max_age_seconds: int = 60 * 60 * 12
    bootstrap_admin_email: str = "admin@example.com"
    bootstrap_admin_password: str = ""
    bootstrap_admin_name: str = "Built-in Admin"
    static_dir: str = "./app/static"

    openai_api_key: str = Field(init=False)
    cors_origins: list[str] = Field(init=False)

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url

    @property
    def static_path(self) -> Path:
        return Path(self.static_dir)


@lru_cache
def get_settings() -> Settings:
    return Settings()
