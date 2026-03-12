from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    app_env: str = "development"
    database_url: str = "sqlite:///./report_foundry.db"
    openai_api_key: str = ""
    auth_secret_key: str = "replace-me"
    auth_salt: str = "report-foundry-auth"
    auth_token_max_age_seconds: int = 60 * 60 * 12
    user_seed_file: str = "./data/users.json"
    bootstrap_admin_email: str = "admin@example.com"
    bootstrap_admin_password: str = ""
    bootstrap_admin_name: str = "Built-in Admin"
    static_dir: str = "./app/static"
    port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("sqlite:///"):
            return self.database_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return self.database_url

    @property
    def user_seed_path(self) -> Path:
        return Path(self.user_seed_file)

    @property
    def static_path(self) -> Path:
        return Path(self.static_dir)


@lru_cache
def get_settings() -> Settings:
    return Settings()
