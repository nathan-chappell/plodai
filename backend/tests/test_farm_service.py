import asyncio

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.advisory import AdvisoryCaseCreateRequest, AdvisoryRecordPayload
from backend.app.services.advisory_service import AdvisoryService


def test_advisory_service_creates_and_saves_canonical_records() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = AdvisoryService(db)
            advisory_case = await service.create_case(
                user_id="user_123",
                request=AdvisoryCaseCreateRequest(title=" North orchard "),
            )

            assert advisory_case.title == "North orchard"
            assert advisory_case.image_count == 0

            initial_record = await service.get_record(
                user_id="user_123",
                case_id=advisory_case.id,
            )
            assert initial_record.model_dump(mode="json") == {
                "version": "v2",
                "title": "North orchard",
                "profile_description": None,
                "default_location": None,
                "subjects": [],
                "reports": [],
                "queries": [],
                "measurements": [],
                "materials": [],
            }

            saved_record = await service.save_record(
                user_id="user_123",
                case_id=advisory_case.id,
                record=AdvisoryRecordPayload(
                    version="v2",
                    title="North orchard updated",
                    profile_description="Main walnut block",
                    default_location="East field",
                    subjects=[
                        {
                            "id": "subject_1",
                            "name": "Walnut row A",
                            "kind": "crop",
                            "type": "tree_nuts",
                            "location": "East block",
                            "description": "Main production zone",
                            "quantity": "12 acres",
                            "status": "active",
                            "notes": "Expected yield approx. 4 tons",
                        }
                    ],
                    reports=[
                        {
                            "id": "report_1",
                            "category": "disease",
                            "title": "Blight pressure",
                            "severity": "high",
                            "status": "monitoring",
                            "recommended_follow_up": "Check irrigation line by 2026-04-15.",
                            "subject_ids": ["subject_1"],
                        },
                    ],
                    queries=[
                        {
                            "id": "query_1",
                            "category": "production",
                            "question": "When should the irrigation line be checked?",
                            "status": "open",
                        },
                    ],
                    measurements=[],
                    materials=[],
                ),
            )

            assert saved_record.title == "North orchard updated"
            assert saved_record.subjects[0].location == "East block"
            assert saved_record.reports[0].title == "Blight pressure"

            hydrated_case = await service.get_case(
                user_id="user_123",
                case_id=advisory_case.id,
            )
            assert hydrated_case.title == "North orchard updated"
            assert hydrated_case.profile_description == "Main walnut block"
            assert hydrated_case.default_location == "East field"

    asyncio.run(_run())


def test_advisory_service_bootstraps_a_blank_default_case_for_new_users() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = AdvisoryService(db)

            cases = await service.list_cases(user_id="user_456")

            assert len(cases) == 1
            assert cases[0].title == ""

            record = await service.get_record(
                user_id="user_456",
                case_id=cases[0].id,
            )
            assert record.model_dump(mode="json") == {
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

            cases_again = await service.list_cases(user_id="user_456")
            assert [advisory_case.id for advisory_case in cases_again] == [cases[0].id]

    asyncio.run(_run())


def test_advisory_service_deletes_cases_and_excludes_them_from_future_lists() -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            service = AdvisoryService(db)
            advisory_case = await service.create_case(
                user_id="user_delete_123",
                request=AdvisoryCaseCreateRequest(title="Delete me"),
            )

            await service.delete_case(
                user_id="user_delete_123",
                case_id=advisory_case.id,
            )

            cases = await service.list_cases(user_id="user_delete_123")
            assert all(item.id != advisory_case.id for item in cases)

    asyncio.run(_run())
