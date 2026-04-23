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
DEV_RELOAD_WATCH_DIRS = [ROOT_DIR / "backend"]
DEV_RELOAD_EXCLUDE_DIRS = [
    ROOT_DIR / "frontend",
    ROOT_DIR / "notes",
    ROOT_DIR / "dist",
    ROOT_DIR / "node_modules",
    ROOT_DIR / ".venv",
    ROOT_DIR / "tmp",
    ROOT_DIR / "playwright-report",
    ROOT_DIR / "test-results",
]


class EntrypointSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    HOST: str = "localhost"
    PORT: int = 8000
    DEV_RELOAD: bool = False


def _read_version() -> str:
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "unknown"
    version = data.get("version")
    return version if isinstance(version, str) and version else "unknown"


def _existing_dirs(paths: list[Path]) -> list[str]:
    return [str(path) for path in paths if path.is_dir()]


if __name__ == "__main__":
    version = _read_version()
    print(f"plodai version={version}")
    print(f"python={platform.python_version()} cwd={Path.cwd()}")
    print(f"frontend_dist={DIST_DIR} exists={DIST_DIR.exists()}")

    configure_logging(logging.INFO)
    settings = EntrypointSettings()
    print(f"bind_host={settings.HOST} bind_port={settings.PORT}")
    uvicorn.run(
        "backend.app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEV_RELOAD,
        reload_dirs=_existing_dirs(DEV_RELOAD_WATCH_DIRS),
        reload_excludes=_existing_dirs(DEV_RELOAD_EXCLUDE_DIRS),
        log_config=None,
        access_log=True,
    )
