import asyncio

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.farm import FarmCreateRequest, FarmRecordPayload
from backend.app.services.farm_service import FarmService


def test_farm_service_creates_and_saves_canonical_records() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = FarmService(db)
            farm = await service.create_farm(
                user_id="user_123",
                request=FarmCreateRequest(name=" North orchard "),
            )

            assert farm.name == "North orchard"
            assert farm.image_count == 0

            initial_record = await service.get_record(
                user_id="user_123",
                farm_id=farm.id,
            )
            assert initial_record.model_dump(mode="json") == {
                "version": "v1",
                "farm_name": "North orchard",
                "description": None,
                "location": None,
                "areas": [],
                "crops": [],
                "work_items": [],
                "orders": [],
            }

            saved_record = await service.save_record(
                user_id="user_123",
                farm_id=farm.id,
                record=FarmRecordPayload(
                    version="v1",
                    farm_name="North orchard updated",
                    description="Main walnut block",
                    location="East field",
                    areas=[
                        {
                            "id": "area_1",
                            "name": "East block",
                            "kind": "orchard",
                        }
                    ],
                    crops=[
                        {
                            "id": "crop_1",
                            "name": "Walnut row A",
                            "type": "tree_nuts",
                            "quantity": "12 acres",
                            "expected_yield": "4 tons",
                            "area_ids": ["area_1"],
                            "status": "active",
                            "notes": "Main production zone",
                        }
                    ],
                    work_items=[
                        {
                            "id": "work_1",
                            "kind": "issue",
                            "title": "Blight pressure",
                            "severity": "high",
                            "status": "monitoring",
                            "due_at": "2026-04-15",
                            "related_crop_ids": ["crop_1"],
                            "related_area_ids": ["area_1"],
                            "related_image_ids": [],
                        },
                        {
                            "id": "work_2",
                            "kind": "task",
                            "title": "Check irrigation line",
                            "status": "open",
                            "related_crop_ids": [],
                            "related_area_ids": ["area_1"],
                            "related_image_ids": [],
                        },
                    ],
                    orders=[],
                ),
            )

            assert saved_record.farm_name == "North orchard updated"
            assert saved_record.areas[0].name == "East block"
            assert saved_record.work_items[1].title == "Check irrigation line"

            hydrated_farm = await service.get_farm(
                user_id="user_123",
                farm_id=farm.id,
            )
            assert hydrated_farm.name == "North orchard updated"
            assert hydrated_farm.description == "Main walnut block"
            assert hydrated_farm.location == "East field"

    asyncio.run(_run())


def test_farm_service_bootstraps_a_blank_default_farm_for_new_users() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = FarmService(db)

            farms = await service.list_farms(user_id="user_456")

            assert len(farms) == 1
            assert farms[0].name == ""

            record = await service.get_record(
                user_id="user_456",
                farm_id=farms[0].id,
            )
            assert record.model_dump(mode="json") == {
                "version": "v1",
                "farm_name": "",
                "description": None,
                "location": None,
                "areas": [],
                "crops": [],
                "work_items": [],
                "orders": [],
            }

            farms_again = await service.list_farms(user_id="user_456")
            assert [farm.id for farm in farms_again] == [farms[0].id]

    asyncio.run(_run())


def test_farm_service_deletes_farms_and_excludes_them_from_future_lists() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = FarmService(db)
            farm = await service.create_farm(
                user_id="user_delete_123",
                request=FarmCreateRequest(name="Delete me"),
            )

            await service.delete_farm(
                user_id="user_delete_123",
                farm_id=farm.id,
            )

            farms = await service.list_farms(user_id="user_delete_123")
            assert all(item.id != farm.id for item in farms)

    asyncio.run(_run())
