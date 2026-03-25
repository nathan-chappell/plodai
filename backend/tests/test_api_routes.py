
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.routes import router
from backend.app.core.auth import AuthenticatedUser, require_admin_user, require_current_user
from backend.app.db.session import AsyncSessionLocal, get_db


TEST_USER = AuthenticatedUser(
    id="user_123",
    email="user@example.com",
    full_name="Test User",
    role="user",
    is_active=True,
    credit_floor_usd=0.0,
)


def build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override_db():
        async with AsyncSessionLocal() as db:
            yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[require_current_user] = lambda: TEST_USER
    app.dependency_overrides[require_admin_user] = lambda: TEST_USER
    return app


def test_farm_routes_support_create_get_and_save_record() -> None:
    app = build_test_app()

    with TestClient(app) as client:
        create_response = client.post("/api/farms", json={"name": "API farm"})
        assert create_response.status_code == 200
        farm = create_response.json()
        farm_id = farm["id"]
        assert farm["name"] == "API farm"
        assert farm["images"] == []

        record_response = client.get(f"/api/farms/{farm_id}/record")
        assert record_response.status_code == 200
        assert record_response.json()["record"]["farm_name"] == "API farm"

        save_response = client.put(
            f"/api/farms/{farm_id}/record",
            json={
                "record": {
                    "version": "v1",
                    "farm_name": "API farm updated",
                    "description": "Saved through the API",
                    "location": "North lot",
                    "crops": [],
                    "orders": [],
                }
            },
        )
        assert save_response.status_code == 200
        assert save_response.json()["record"]["farm_name"] == "API farm updated"

        detail_response = client.get(f"/api/farms/{farm_id}")
        assert detail_response.status_code == 200
        assert detail_response.json()["name"] == "API farm updated"
        assert detail_response.json()["description"] == "Saved through the API"
