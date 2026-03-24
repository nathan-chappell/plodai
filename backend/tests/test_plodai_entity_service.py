from __future__ import annotations

import io
from uuid import uuid4

import pytest

from backend.app.db.session import AsyncSessionLocal
from backend.app.models.chatkit import WorkspaceChat
from backend.app.models.workspace import Workspace
from backend.app.schemas.workspace import FarmItemPayload, WorkspaceItemCreateRequest
from backend.app.services.plodai_entity_service import PlodaiEntityService
from backend.app.services.stored_file_service import StoredFileService
from backend.app.services.workspace_service import WorkspaceService
from backend.tests.fake_bucket_storage import FakeBucketStorage


def _build_test_image_bytes() -> bytes:
    from PIL import Image

    image = Image.new("RGB", (14, 10), color=(112, 160, 110))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


async def _create_workspace_and_chat(
    *,
    db,
    user_id: str,
    workspace_id: str,
    thread_id: str,
) -> None:
    db.add(
        Workspace(
            id=workspace_id,
            user_id=user_id,
            app_id="plodai",
            name="North Orchard",
            active_chat_id=thread_id,
        )
    )
    db.add(
        WorkspaceChat(
            id=thread_id,
            user_id=user_id,
            workspace_id=workspace_id,
            title="PlodAI",
            metadata_json={},
            status_json={"type": "active"},
            allowed_image_domains_json=None,
            updated_sequence=1,
        )
    )
    await db.commit()


@pytest.mark.anyio
async def test_plodai_entity_service_returns_bucket_preview_urls_for_thread_images(
    initialized_db: None,
) -> None:
    user_id = f"user_entity_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"
    farm_item_id = f"farm-overview-{uuid4().hex}"
    bucket = FakeBucketStorage()

    async with AsyncSessionLocal() as db:
        await _create_workspace_and_chat(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
        )

        stored_file_service = StoredFileService(db, bucket_service=bucket)
        uploaded = await stored_file_service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="orchard-canopy.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_1",
            scope="chat_attachment",
            thread_id=thread_id,
            create_attachment=True,
        )

        workspace_service = WorkspaceService(db)
        await workspace_service.create_item(
            user_id=user_id,
            workspace_id=workspace_id,
            request=WorkspaceItemCreateRequest(
                id=farm_item_id,
                kind="farm.v1",
                created_by_agent_id="plodai-agent",
                payload=FarmItemPayload(
                    version="v1",
                    farm_name="North Orchard",
                    location="Block A",
                    crops=[
                        {
                            "id": "crop_1",
                            "name": "Honeycrisp apples",
                            "area": "12 acres",
                            "expected_yield": "480 bins",
                        }
                    ],
                    orders=[
                        {
                            "id": "order_1",
                            "title": "Sataras mix",
                            "status": "live",
                            "price_label": "9 EUR",
                            "summary": "2 kg onions, 2 kg peppers, 2 kg tomatoes.",
                            "order_url": "https://farm.example/orders/sataras-mix",
                            "items": [
                                {
                                    "id": "order_item_1",
                                    "label": "Onions",
                                    "quantity": "2 kg",
                                }
                            ],
                        }
                    ],
                    notes="Keep an eye on the west edge.",
                ),
            ),
        )

        response = await PlodaiEntityService(
            db,
            file_service=stored_file_service,
        ).search_entities(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            thread_id=thread_id,
            query="orchard",
        )

        assert response.entities
        image_entity = next(
            entity for entity in response.entities if entity.data.get("entity_type") == "thread_image"
        )
        assert image_entity.title == "orchard-canopy.png"
        assert image_entity.data["stored_file_id"] == uploaded.stored_file.id
        assert image_entity.data["file_id"] == uploaded.stored_file.id
        assert image_entity.data["workspace_item_id"] == uploaded.stored_file.id
        assert image_entity.data["preview_url"].startswith(
            f"https://bucket.test/{uploaded.stored_file.storage_key}"
        )
        assert "kind=get" in image_entity.data["preview_url"]

        crop_entity = next(
            entity for entity in response.entities if entity.data.get("entity_type") == "farm_crop"
        )
        assert crop_entity.title == "Honeycrisp apples"
        assert crop_entity.data["artifact_id"] == farm_item_id

        order_entity = next(
            entity for entity in response.entities if entity.data.get("entity_type") == "farm_order"
        )
        assert order_entity.title == "Sataras mix"
        assert order_entity.data["price_label"] == "9 EUR"


@pytest.mark.anyio
async def test_plodai_entity_service_filters_thread_images_to_current_thread(
    initialized_db: None,
) -> None:
    user_id = f"user_entity_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    active_thread_id = f"thread_{uuid4().hex}"
    other_thread_id = f"thread_{uuid4().hex}"
    bucket = FakeBucketStorage()

    async with AsyncSessionLocal() as db:
        await _create_workspace_and_chat(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=active_thread_id,
        )
        db.add(
            WorkspaceChat(
                id=other_thread_id,
                user_id=user_id,
                workspace_id=workspace_id,
                title="PlodAI",
                metadata_json={},
                status_json={"type": "active"},
                allowed_image_domains_json=None,
                updated_sequence=2,
            )
        )
        await db.commit()

        stored_file_service = StoredFileService(db, bucket_service=bucket)
        await stored_file_service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="active-thread.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_active",
            scope="chat_attachment",
            thread_id=active_thread_id,
            create_attachment=True,
        )
        await stored_file_service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="other-thread.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_other",
            scope="chat_attachment",
            thread_id=other_thread_id,
            create_attachment=True,
        )

        response = await PlodaiEntityService(
            db,
            file_service=stored_file_service,
        ).search_entities(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            thread_id=active_thread_id,
            query="",
        )

        titles = [entity.title for entity in response.entities if entity.data.get("entity_type") == "thread_image"]
        assert "active-thread.png" in titles
        assert "other-thread.png" not in titles
