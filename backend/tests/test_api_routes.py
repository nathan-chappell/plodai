from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.routes import router
from backend.app.core.auth import (
    AuthenticatedUser,
    require_admin_user,
    require_current_user,
)
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


def test_advisory_routes_support_create_get_and_save_record() -> None:
    app = build_test_app()

    with TestClient(app) as client:
        create_response = client.post("/api/advisory/cases", json={"title": "API case"})
        assert create_response.status_code == 200
        advisory_case = create_response.json()
        case_id = advisory_case["id"]
        assert advisory_case["title"] == "API case"
        assert advisory_case["images"] == []

        record_response = client.get(f"/api/advisory/cases/{case_id}/record")
        assert record_response.status_code == 200
        assert record_response.json()["record"]["title"] == "API case"
        assert record_response.json()["record"]["subjects"] == []
        assert record_response.json()["record"]["reports"] == []

        save_response = client.put(
            f"/api/advisory/cases/{case_id}/record",
            json={
                "record": {
                    "version": "v2",
                    "title": "API case updated",
                    "profile_description": "Saved through the API",
                    "default_location": "North lot",
                    "subjects": [
                        {
                            "id": "subject_1",
                            "name": "Walnut block",
                            "kind": "crop",
                            "location": "North orchard",
                        }
                    ],
                    "reports": [
                        {
                            "id": "report_1",
                            "category": "other",
                            "title": "Check sprayer",
                            "subject_ids": ["subject_1"],
                        }
                    ],
                    "queries": [],
                    "measurements": [],
                    "materials": [],
                }
            },
        )
        assert save_response.status_code == 200
        assert save_response.json()["record"]["title"] == "API case updated"
        assert save_response.json()["record"]["reports"][0]["title"] == "Check sprayer"

        detail_response = client.get(f"/api/advisory/cases/{case_id}")
        assert detail_response.status_code == 200
        assert detail_response.json()["title"] == "API case updated"
        assert detail_response.json()["profile_description"] == "Saved through the API"


def test_advisory_routes_support_delete() -> None:
    app = build_test_app()

    with TestClient(app) as client:
        create_response = client.post("/api/advisory/cases", json={"title": "Delete API case"})
        assert create_response.status_code == 200
        case_id = create_response.json()["id"]

        delete_response = client.delete(f"/api/advisory/cases/{case_id}")
        assert delete_response.status_code == 200
        assert delete_response.json() == {
            "case_id": case_id,
            "deleted": True,
        }

        list_response = client.get("/api/advisory/cases")
        assert list_response.status_code == 200
        cases = list_response.json()
        assert all(item["id"] != case_id for item in cases)


def test_advisory_routes_bootstrap_a_blank_default_case() -> None:
    app = build_test_app()

    with TestClient(app) as client:
        list_response = client.get("/api/advisory/cases")
        assert list_response.status_code == 200
        cases = list_response.json()
        assert len(cases) == 1

        advisory_case = cases[0]
        assert advisory_case["title"] == ""

        record_response = client.get(f"/api/advisory/cases/{advisory_case['id']}/record")
        assert record_response.status_code == 200
        assert record_response.json()["record"] == {
            "version": "v2",
            "title": "",
            "profile_description": None,
            "default_location": None,
            "subjects": [],
            "reports": [],
            "queries": [],
            "measurements": [],
            "materials": [],
        }

        second_list_response = client.get("/api/advisory/cases")
        assert second_list_response.status_code == 200
        second_cases = second_list_response.json()
        assert [item["id"] for item in second_cases] == [advisory_case["id"]]
