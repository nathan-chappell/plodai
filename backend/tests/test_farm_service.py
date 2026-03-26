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
                "crops": [],
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
                    crops=[],
                    orders=[],
                ),
            )

            assert saved_record.farm_name == "North orchard updated"

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
                "crops": [],
                "orders": [],
            }

            farms_again = await service.list_farms(user_id="user_456")
            assert [farm.id for farm in farms_again] == [farms[0].id]

    asyncio.run(_run())
