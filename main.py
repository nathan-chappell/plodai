import json
import logging
import platform
from pathlib import Path

import uvicorn
from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.app.core.logging import configure_logging

ROOT_DIR = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT_DIR / "package.json"
DIST_DIR = ROOT_DIR / "dist"


class EntrypointSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    HOST: str = "localhost"
    PORT: int = 8000


def _read_version() -> str:
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "unknown"
    version = data.get("version")
    return version if isinstance(version, str) and version else "unknown"


if __name__ == "__main__":
    version = _read_version()
    print(f"report-foundry version={version}")
    print(f"python={platform.python_version()} cwd={Path.cwd()}")
    print(f"frontend_dist={DIST_DIR} exists={DIST_DIR.exists()}")

    configure_logging(logging.INFO)
    settings = EntrypointSettings()
    print(f"bind_host={settings.HOST} bind_port={settings.PORT}")
    uvicorn.run(
        "backend.app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        log_config=None,
        access_log=True,
    )
