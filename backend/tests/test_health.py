from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from starlette.routing import Mount

from backend.app import main as main_module
from backend.app.main import app


def test_healthcheck():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_configure_frontend_assets_skips_missing_build(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    application = FastAPI()
    monkeypatch.setattr(main_module, "static_path", tmp_path / "missing-dist")
    monkeypatch.setattr(main_module, "assets_path", tmp_path / "missing-dist" / "assets")

    main_module._configure_frontend_assets(application)

    assert not any(
        isinstance(route, Mount) and route.path == "/assets"
        for route in application.routes
    )
