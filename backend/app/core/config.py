from functools import lru_cache

from pydantic import Field
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
    allowed_users_raw: str = Field(
        default="demo@example.com",
        alias="ALLOWED_USERS",
    )
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @property
    def allowed_users(self) -> set[str]:
        return {
            item.strip().lower()
            for item in self.allowed_users_raw.split(",")
            if item.strip()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
