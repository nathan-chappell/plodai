import io
from types import SimpleNamespace
from uuid import uuid4

import pytest
from chatkit.types import ImageAttachment
from fastapi import HTTPException
from PIL import Image

from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.core.config import get_settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.chatkit import WorkspaceChat
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace
from backend.app.services.stored_file_service import StoredFileService


class _StubFilesClient:
    async def create(self, **_: object) -> SimpleNamespace:
        return SimpleNamespace(id=f"file_openai_stub_{uuid4().hex}")


class _StubOpenAIClient:
    def __init__(self) -> None:
        self.files = _StubFilesClient()


def _build_test_image_bytes() -> bytes:
    image = Image.new("RGB", (12, 8), color=(126, 171, 119))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.anyio
async def test_agriculture_chat_attachment_accepts_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="agriculture",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=False,
        )

        assert response.stored_file.kind == "image"
        assert response.stored_file.app_id == "agriculture"
        assert response.stored_file.preview.kind == "image"
        assert response.stored_file.preview.width == 12
        assert response.stored_file.preview.height == 8
        assert response.attachment is None


@pytest.mark.anyio
async def test_agriculture_chat_attachment_rejects_non_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )

        with pytest.raises(HTTPException) as exc_info:
            await service.create_chat_attachment_upload(
                user_id=user_id,
                workspace_id=workspace_id,
                app_id="agriculture",
                file_name="notes.csv",
                mime_type="text/csv",
                file_bytes=b"region,revenue\nWest,10\n",
                attachment_id="",
                scope="chat_attachment",
                thread_id=None,
                create_attachment=False,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "Agriculture chat attachments must be image files."


@pytest.mark.anyio
async def test_agriculture_chat_attachment_rejects_oversized_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )

        with pytest.raises(HTTPException) as exc_info:
            await service.create_chat_attachment_upload(
                user_id=user_id,
                workspace_id=workspace_id,
                app_id="agriculture",
                file_name="large-orchard.jpeg",
                mime_type="image/jpeg",
                file_bytes=_build_test_image_bytes() + b"x" * ((10 * 1024 * 1024) + 1),
                attachment_id="",
                scope="chat_attachment",
                thread_id=None,
                create_attachment=False,
            )

        assert exc_info.value.status_code == 413
        assert exc_info.value.detail == "Agriculture chat attachments must be 10 MB or smaller."


@pytest.mark.anyio
async def test_agriculture_chat_attachment_returns_chatkit_image_shape(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="agriculture",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_image_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        assert response.attachment is not None
        assert response.attachment.type == "image"
        assert response.attachment.id == "attachment_image_1"
        assert response.attachment.name == "orchard.png"
        assert response.attachment.mime_type == "image/png"
        assert isinstance(response.attachment.preview_url, str)
        assert response.attachment.preview_url.startswith(
            f"http://localhost/api/stored-files/{response.stored_file.id}/preview?token="
        )

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        assert record.preview_json == {"kind": "image", "width": 12, "height": 8}
        assert "bytes_base64" not in record.preview_json


@pytest.mark.anyio
async def test_pending_attachment_links_to_thread_when_chatkit_saves_it(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
                active_chat_id=thread_id,
            )
        )
        db.add(
            WorkspaceChat(
                id=thread_id,
                user_id=user_id,
                workspace_id=workspace_id,
                title="Agriculture",
                metadata_json={},
                status_json={"type": "active"},
                allowed_image_domains_json=None,
                updated_sequence=1,
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="agriculture",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_image_2",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        initial_record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert initial_record is not None
        assert initial_record.thread_id is None

        stored_attachment = await DatabaseMemoryStore(db).load_attachment(
            "attachment_image_2",
            context=None,
        )
        assert isinstance(stored_attachment, ImageAttachment)

        await DatabaseMemoryStore(db).save_attachment(
            stored_attachment.model_copy(update={"thread_id": thread_id}),
            context=None,
        )

        updated_record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert updated_record is not None
        assert updated_record.thread_id == thread_id


@pytest.mark.anyio
async def test_public_preview_token_resolves_image_without_user_auth(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="agriculture",
                name="Agriculture workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="agriculture",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_preview_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        preview_url = response.attachment.preview_url if response.attachment else None
        assert isinstance(preview_url, str)
        token = preview_url.split("token=", 1)[1]

        preview_record = await service.get_preview_file(
            file_id=response.stored_file.id,
            token=token,
        )
        assert preview_record.id == response.stored_file.id
