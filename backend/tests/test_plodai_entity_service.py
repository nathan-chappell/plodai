import asyncio
import base64

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.farm import FarmCreateRequest, FarmRecordPayload
from backend.app.services.farm_image_service import FarmImageService
from backend.app.services.farm_service import FarmService
from backend.app.services.plodai_entity_service import PlodaiEntityService
from backend.tests.fake_bucket_storage import FakeBucketStorage

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+R2QAAAAASUVORK5CYII="
)


def test_entity_search_uses_saved_farm_record_and_images() -> None:
    async def _run() -> None:
        bucket = FakeBucketStorage()
        async with AsyncSessionLocal() as db:
            farm_service = FarmService(db)
            image_service = FarmImageService(db, bucket_service=bucket)
            entity_service = PlodaiEntityService(
                db,
                image_service=image_service,
                farm_service=farm_service,
            )

            farm = await farm_service.create_farm(
                user_id="user_123",
                request=FarmCreateRequest(name="Walnut south"),
            )
            image = await image_service.upload_image(
                user_id="user_123",
                farm_id=farm.id,
                file_name="south-canopy.png",
                mime_type="image/png",
                file_bytes=ONE_PIXEL_PNG,
            )

            await farm_service.save_record(
                user_id="user_123",
                farm_id=farm.id,
                record=FarmRecordPayload(
                    version="v1",
                    farm_name="Walnut south",
                    description="Weekly scouting",
                    location="South field",
                    crops=[
                        {
                            "id": "crop_1",
                            "name": "Block A",
                            "type": "walnut",
                            "size": "12 acres",
                            "expected_yield": "4 tons",
                            "issues": [
                                {
                                    "id": "issue_1",
                                    "title": "Blight pressure",
                                    "severity": "high",
                                }
                            ],
                        }
                    ],
                    orders=[
                        {
                            "id": "order_1",
                            "title": "Fresh walnut boxes",
                            "status": "live",
                            "summary": "Weekly harvest box",
                            "price_label": "$24",
                            "order_url": "https://example.com/orders/1",
                            "items": [],
                            "hero_image_file_id": image.id,
                        }
                    ],
                ),
            )

            response = await entity_service.search_entities(
                user_id="user_123",
                farm_id=farm.id,
                query="",
            )

            entity_types = {entity.data["entity_type"] for entity in response.entities}
            assert entity_types == {"farm_image", "farm_crop", "farm_order"}

    asyncio.run(_run())
