import json
import platform
from pathlib import Path

import uvicorn

ROOT_DIR = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT_DIR / "package.json"
DIST_DIR = ROOT_DIR / "dist"


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
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
    )
