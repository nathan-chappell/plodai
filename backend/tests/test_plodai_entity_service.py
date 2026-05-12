import asyncio
import base64

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.advisory import AdvisoryCaseCreateRequest, AdvisoryRecordPayload
from backend.app.services.advisory_image_service import AdvisoryImageService
from backend.app.services.advisory_service import AdvisoryService
from backend.app.services.plodai_entity_service import PlodaiEntityService
from backend.tests.fake_bucket_storage import FakeBucketStorage

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+R2QAAAAASUVORK5CYII="
)


def test_entity_search_uses_saved_advisory_record_and_images() -> None:
    async def _run() -> None:
        bucket = FakeBucketStorage()
        async with AsyncSessionLocal() as db:
            advisory_service = AdvisoryService(db)
            image_service = AdvisoryImageService(db, bucket_service=bucket)
            entity_service = PlodaiEntityService(
                db,
                image_service=image_service,
                advisory_service=advisory_service,
            )

            advisory_case = await advisory_service.create_case(
                user_id="user_123",
                request=AdvisoryCaseCreateRequest(title="Walnut south"),
            )
            image = await image_service.upload_image(
                user_id="user_123",
                case_id=advisory_case.id,
                file_name="south-canopy.png",
                mime_type="image/png",
                file_bytes=ONE_PIXEL_PNG,
            )

            await advisory_service.save_record(
                user_id="user_123",
                case_id=advisory_case.id,
                record=AdvisoryRecordPayload(
                    version="v2",
                    title="Walnut south",
                    profile_description="Weekly scouting",
                    default_location="South field",
                    subjects=[
                        {
                            "id": "subject_1",
                            "name": "Block A",
                            "kind": "crop",
                            "type": "tree_nuts",
                            "location": "South block",
                            "quantity": "12 acres",
                            "status": "active",
                            "notes": "Main production zone. Expected yield approx. 4 tons.",
                        }
                    ],
                    reports=[
                        {
                            "id": "report_1",
                            "category": "disease",
                            "title": "Blight pressure",
                            "description": "Scattered lesions in the outer canopy.",
                            "severity": "high",
                            "status": "monitoring",
                            "recommended_follow_up": "Inspect again by 2026-04-12.",
                            "subject_ids": ["subject_1"],
                            "evidence_image_ids": [image.id],
                        }
                    ],
                    queries=[
                        {
                            "id": "query_1",
                            "category": "input_sourcing",
                            "question": "Where can I find walnut blight materials?",
                            "status": "answered",
                            "source_urls": ["https://example.com/orders/1"],
                        }
                    ],
                    measurements=[
                        {
                            "id": "measurement_1",
                            "label": "Affected canopy",
                            "value": "12",
                            "unit": "percent",
                            "subject_ids": ["subject_1"],
                            "report_ids": ["report_1"],
                        }
                    ],
                    materials=[
                        {
                            "id": "material_1",
                            "name": "Copper fungicide",
                            "purpose": "Blight management",
                            "category": "plant_protection",
                            "status": "to_check",
                            "supplier_url": "https://example.com/orders/1",
                        }
                    ],
                ),
            )

            response = await entity_service.search_entities(
                user_id="user_123",
                case_id=advisory_case.id,
                query="",
            )

            entity_types = {entity.data["entity_type"] for entity in response.entities}
            assert entity_types == {
                "advisory_image",
                "advisory_subject",
                "advisory_report",
                "advisory_query",
                "advisory_measurement",
                "advisory_material",
            }
            subject_entity = next(
                entity for entity in response.entities if entity.data["entity_type"] == "advisory_subject"
            )
            assert subject_entity.data["type"] == "tree_nuts"
            assert subject_entity.data["quantity"] == "12 acres"
            assert subject_entity.data["location"] == "South block"
            report_entity = next(
                entity
                for entity in response.entities
                if entity.data["entity_type"] == "advisory_report"
            )
            assert report_entity.data["subject_names"] == "Block A"

            filtered_response = await entity_service.search_entities(
                user_id="user_123",
                case_id=advisory_case.id,
                query="south block",
            )
            assert any(
                entity.data["entity_type"] == "advisory_subject"
                for entity in filtered_response.entities
            )

    asyncio.run(_run())
