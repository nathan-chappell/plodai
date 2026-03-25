import asyncio
import base64

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.farm import FarmCreateRequest, FarmRecordPayload
from backend.app.services.farm_image_service import FarmImageService
from backend.app.services.farm_service import FarmService
from backend.app.services.public_farm_order_service import PublicFarmOrderService
from backend.tests.fake_bucket_storage import FakeBucketStorage

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+R2QAAAAASUVORK5CYII="
)


def test_public_farm_order_service_reads_live_order_and_hero_image() -> None:
    async def _run() -> None:
        bucket = FakeBucketStorage()
        async with AsyncSessionLocal() as db:
            farm_service = FarmService(db)
            image_service = FarmImageService(db, bucket_service=bucket)
            service = PublicFarmOrderService(
                db,
                image_service=image_service,
                farm_service=farm_service,
            )

            farm = await farm_service.create_farm(
                user_id="user_123",
                request=FarmCreateRequest(name="West walnuts"),
            )
            image = await image_service.upload_image(
                user_id="user_123",
                farm_id=farm.id,
                file_name="hero.png",
                mime_type="image/png",
                file_bytes=ONE_PIXEL_PNG,
            )

            await farm_service.save_record(
                user_id="user_123",
                farm_id=farm.id,
                record=FarmRecordPayload(
                    version="v1",
                    farm_name="West walnuts",
                    description="Market-ready crop",
                    location="West field",
                    crops=[],
                    orders=[
                        {
                            "id": "order_live",
                            "title": "Fresh walnuts",
                            "status": "live",
                            "summary": "Pickup on Fridays",
                            "price_label": "$18",
                            "order_url": "https://example.com/order-live",
                            "items": [],
                            "hero_image_file_id": image.id,
                        }
                    ],
                ),
            )

            response = await service.get_public_order(
                farm_id=farm.id,
                order_id="order_live",
                public_base_url="http://localhost:8000",
            )

            assert response.farm_name == "West walnuts"
            assert response.order.id == "order_live"
            assert response.hero_image_preview_url is not None
            assert "hero.png" in response.hero_image_preview_url

    asyncio.run(_run())
