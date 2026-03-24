import asyncio
import io
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from chatkit.types import (
    AttachmentCreateParams,
    FileAttachment,
    ImageAttachment,
    InferenceOptions,
    ThreadItemDoneEvent,
    ThreadMetadata,
    UserMessageItem,
    UserMessageTagContent,
    UserMessageTextContent,
)
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.server import ClientWorkspaceChatKitServer
from backend.app.core.config import get_settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.main import app
from backend.app.models.chatkit import WorkspaceChat, WorkspaceChatEntry
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace
from backend.app.services.stored_file_service import StoredFileService


class _StubFilesClient:
    def __init__(self) -> None:
        self.create_calls: list[dict[str, object]] = []
        self.file_bytes_by_id: dict[str, bytes] = {}

    async def create(self, **kwargs: object) -> SimpleNamespace:
        self.create_calls.append(kwargs)
        file_id = f"file_openai_stub_{uuid4().hex}"
        raw_file = kwargs.get("file")
        if isinstance(raw_file, tuple) and len(raw_file) >= 2 and isinstance(raw_file[1], bytes):
            self.file_bytes_by_id[file_id] = raw_file[1]
        return SimpleNamespace(id=file_id)

    async def delete(self, _: str) -> SimpleNamespace:
        return SimpleNamespace(deleted=True)

    async def content(self, file_id: str) -> SimpleNamespace:
        file_bytes = self.file_bytes_by_id.get(file_id, b"")
        return SimpleNamespace(aread=lambda: _return_bytes(file_bytes))


class _StubOpenAIClient:
    def __init__(self) -> None:
        self.files = _StubFilesClient()


async def _return_bytes(file_bytes: bytes) -> bytes:
    return file_bytes


def _build_test_image_bytes() -> bytes:
    image = Image.new("RGB", (12, 8), color=(126, 171, 119))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _assert_signed_preview_url(value: str) -> None:
    parsed = urlparse(value)
    assert parsed.scheme in {"http", "https"}
    assert parsed.netloc
    assert parsed.path.startswith("/api/stored-files/file_")
    assert "token" in parse_qs(parsed.query)


def _flatten_message_contents(
    input_items: list[dict[str, object]],
) -> list[dict[str, object]]:
    contents: list[dict[str, object]] = []
    for item in input_items:
        if item.get("type") != "message":
            continue
        raw_contents = item.get("content")
        if not isinstance(raw_contents, list):
            continue
        for content in raw_contents:
            if isinstance(content, dict):
                contents.append(content)
    return contents


async def _create_pending_attachment(
    *,
    user_id: str,
    workspace_id: str,
    image_bytes: bytes,
) -> tuple[str, str]:
    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
            )
        )
        await db.commit()

        store = DatabaseMemoryStore(db, public_base_url="http://testserver")
        attachment = await store.create_attachment(
            AttachmentCreateParams(
                name="orchard.png",
                size=len(image_bytes),
                mime_type="image/png",
            ),
            ReportAgentContext(
                report_id="pending_thread",
                user_id=user_id,
                user_email=None,
                db=db,
                workspace_id=workspace_id,
            ),
        )
        await store.save_attachment(attachment, context=None)

        upload_url = urlparse(str(attachment.upload_descriptor.url))
        token = parse_qs(upload_url.query)["token"][0]
        return attachment.id, token


@pytest.mark.anyio
async def test_memory_store_create_attachment_returns_two_phase_upload_descriptor(
    initialized_db: None,
) -> None:
    user_id = f"user_memory_store_{uuid4().hex}"
    workspace_id = f"workspace_memory_store_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
            )
        )
        await db.commit()

        store = DatabaseMemoryStore(db, public_base_url="http://testserver")
        attachment = await store.create_attachment(
            AttachmentCreateParams(
                name="orchard.png",
                size=len(_build_test_image_bytes()),
                mime_type="image/png",
            ),
            ReportAgentContext(
                report_id="pending_thread",
                user_id=user_id,
                user_email=None,
                db=db,
                workspace_id=workspace_id,
            ),
        )

        assert isinstance(attachment, FileAttachment)
        assert attachment.id.startswith("atc_")
        assert attachment.upload_descriptor is not None
        assert attachment.upload_descriptor.method == "POST"
        assert str(attachment.upload_descriptor.url).startswith(
            f"http://testserver/api/chatkit/attachments/{attachment.id}/content?token="
        )


@pytest.mark.anyio
async def test_chatkit_server_uses_database_memory_store_for_attachments(
    initialized_db: None,
) -> None:
    async with AsyncSessionLocal() as db:
        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
        )

        assert isinstance(server.store, DatabaseMemoryStore)
        assert server.attachment_store is server.store


@pytest.mark.anyio
async def test_plodai_chat_attachment_accepts_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=False,
        )

        assert response.stored_file.kind == "image"
        assert response.stored_file.app_id == "plodai"
        assert response.stored_file.preview.kind == "image"
        assert response.stored_file.preview.width == 12
        assert response.stored_file.preview.height == 8
        assert response.attachment is None


@pytest.mark.anyio
async def test_plodai_chat_attachment_rejects_non_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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
                app_id="plodai",
                file_name="notes.csv",
                mime_type="text/csv",
                file_bytes=b"region,revenue\nWest,10\n",
                attachment_id="",
                scope="chat_attachment",
                thread_id=None,
                create_attachment=False,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "PlodAI chat attachments must be image files."


@pytest.mark.anyio
async def test_plodai_chat_attachment_rejects_oversized_images(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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
                app_id="plodai",
                file_name="large-orchard.jpeg",
                mime_type="image/jpeg",
                file_bytes=_build_test_image_bytes() + b"x" * ((10 * 1024 * 1024) + 1),
                attachment_id="",
                scope="chat_attachment",
                thread_id=None,
                create_attachment=False,
            )

        assert exc_info.value.status_code == 413
        assert exc_info.value.detail == "PlodAI chat attachments must be 10 MB or smaller."


@pytest.mark.anyio
async def test_plodai_chat_attachment_returns_chatkit_image_shape(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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
            app_id="plodai",
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
        _assert_signed_preview_url(str(response.attachment.preview_url))

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        assert record.preview_json == {"kind": "image", "width": 12, "height": 8}
        assert "bytes_base64" not in record.preview_json

        store = DatabaseMemoryStore(
            db,
            openai_client=service.openai_client,
        )
        stored_attachment = await store.load_attachment(
            "attachment_image_1",
            context=None,
        )
        assert isinstance(stored_attachment, FileAttachment)

        hydrated_attachment = await store.load_attachment(
            "attachment_image_1",
            context=None,
            hydrate_preview=True,
        )
        assert isinstance(hydrated_attachment, ImageAttachment)
        _assert_signed_preview_url(str(hydrated_attachment.preview_url))


@pytest.mark.anyio
async def test_stored_file_upload_uses_24h_openai_expiry(
    initialized_db: None,
) -> None:
    user_id = f"user_stored_file_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    openai_client = _StubOpenAIClient()

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
            )
        )
        await db.commit()

        service = StoredFileService(
            db,
            openai_client=openai_client,
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_expiry_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        create_kwargs = openai_client.files.create_calls[0]
        assert create_kwargs["expires_after"] == {
            "anchor": "created_at",
            "seconds": 24 * 60 * 60,
        }

        expires_at_raw = response.stored_file.expires_at
        assert isinstance(expires_at_raw, str)
        expires_at = datetime.fromisoformat(expires_at_raw)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        remaining_seconds = (expires_at - datetime.now(UTC)).total_seconds()
        assert 23 * 60 * 60 <= remaining_seconds <= 24 * 60 * 60 + 5


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
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
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
        assert isinstance(stored_attachment, FileAttachment)

        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_image_2",
            thread_id=thread_id,
        )

        updated_record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert updated_record is not None
        assert updated_record.thread_id == thread_id

        refreshed_attachment = await DatabaseMemoryStore(db).load_attachment(
            "attachment_image_2",
            context=None,
        )
        assert refreshed_attachment.thread_id == thread_id


@pytest.mark.anyio
async def test_server_syncs_plodai_thread_image_refs_after_first_message(
    initialized_db: None,
) -> None:
    user_id = f"user_plodai_refs_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
                active_chat_id=thread_id,
            )
        )
        db.add(
            WorkspaceChat(
                id=thread_id,
                user_id=user_id,
                workspace_id=workspace_id,
                title="PlodAI",
                metadata_json={
                    "workspace_state": {
                        "version": "v4",
                        "workspace_id": workspace_id,
                        "workspace_name": "PlodAI workspace",
                        "app_id": "plodai",
                        "active_chat_id": thread_id,
                        "items": [],
                    }
                },
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
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_ref_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_ref_1",
            thread_id=thread_id,
        )
        attachment_with_thread = await DatabaseMemoryStore(db).load_attachment(
            "attachment_ref_1",
            context=None,
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
        )
        thread = ThreadMetadata(
            id=thread_id,
            title="PlodAI",
            created_at=datetime.now(UTC),
            metadata={
                "workspace_state": {
                    "version": "v4",
                    "workspace_id": workspace_id,
                    "workspace_name": "PlodAI workspace",
                    "app_id": "plodai",
                    "active_chat_id": thread_id,
                    "items": [],
                }
            },
        )
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=db,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
        )

        await server._sync_plodai_thread_image_refs(
            thread=thread,
            context=context,
            attachments=[attachment_with_thread],
        )

        refreshed_chat = await db.get(WorkspaceChat, thread_id)
        assert refreshed_chat is not None
        assert refreshed_chat.metadata_json["plodai_state"] == {
            "thread_image_refs": [
                {
                    "stored_file_id": response.stored_file.id,
                    "attachment_id": "attachment_ref_1",
                    "name": "orchard.png",
                    "mime_type": "image/png",
                    "width": 12,
                    "height": 8,
                }
            ]
        }


@pytest.mark.anyio
async def test_converter_rehydrates_only_tagged_thread_images_as_input_image(
    initialized_db: None,
) -> None:
    user_id = f"user_tagged_refs_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        tagged = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="tagged.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_tagged_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )
        untagged = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="untagged.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_tagged_2",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_tagged_1",
            thread_id=thread_id,
        )
        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_tagged_2",
            thread_id=thread_id,
        )

        thread = ThreadMetadata(
            id=thread_id,
            title="PlodAI",
            created_at=datetime.now(UTC),
            metadata={
                "workspace_state": {
                    "version": "v4",
                    "workspace_id": workspace_id,
                    "workspace_name": "PlodAI workspace",
                    "app_id": "plodai",
                    "active_chat_id": thread_id,
                    "items": [],
                },
                "plodai_state": {
                    "thread_image_refs": [
                        {
                            "stored_file_id": tagged.stored_file.id,
                            "attachment_id": "attachment_tagged_1",
                            "name": "tagged.png",
                            "mime_type": "image/png",
                            "width": 12,
                            "height": 8,
                        },
                        {
                            "stored_file_id": untagged.stored_file.id,
                            "attachment_id": "attachment_tagged_2",
                            "name": "untagged.png",
                            "mime_type": "image/png",
                            "width": 12,
                            "height": 8,
                        },
                    ]
                },
            },
        )
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=db,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
        )
        server.converter.bind_request(thread=thread, context=context)

        user_message = UserMessageItem(
            id="msg_tagged_image",
            thread_id=thread_id,
            created_at=datetime.now(UTC),
            content=[
                UserMessageTextContent(text="Please revisit @tagged.png."),
                UserMessageTagContent(
                    id=f"thread-image:{tagged.stored_file.id}",
                    text="tagged.png",
                    data={
                        "entity_type": "thread_image",
                        "file_id": tagged.stored_file.id,
                        "attachment_id": "attachment_tagged_1",
                    },
                    interactive=True,
                ),
            ],
            attachments=[],
            quoted_text=None,
            inference_options=InferenceOptions(),
        )

        input_items = await server.converter.to_agent_input([user_message])
        contents = _flatten_message_contents(input_items)

        image_inputs = [content for content in contents if content.get("type") == "input_image"]
        assert image_inputs == [
            {
                "type": "input_image",
                "file_id": tagged.stored_file.openai_file_id,
                "detail": "high",
            }
        ]
        assert not any(
            content.get("file_id") == untagged.stored_file.openai_file_id
            for content in image_inputs
        )
        assert any(
            "explicitly referenced from earlier in this thread" in str(content.get("text", ""))
            for content in contents
            if content.get("type") == "input_text"
        )


@pytest.mark.anyio
async def test_converter_reports_unavailable_text_for_expired_tagged_thread_image(
    initialized_db: None,
) -> None:
    user_id = f"user_expired_tagged_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="expired.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_expired_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_expired_1",
            thread_id=thread_id,
        )

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await db.commit()

        thread = ThreadMetadata(
            id=thread_id,
            title="PlodAI",
            created_at=datetime.now(UTC),
            metadata={
                "workspace_state": {
                    "version": "v4",
                    "workspace_id": workspace_id,
                    "workspace_name": "PlodAI workspace",
                    "app_id": "plodai",
                    "active_chat_id": thread_id,
                    "items": [],
                },
                "plodai_state": {
                    "thread_image_refs": [
                        {
                            "stored_file_id": response.stored_file.id,
                            "attachment_id": "attachment_expired_1",
                            "name": "expired.png",
                            "mime_type": "image/png",
                            "width": 12,
                            "height": 8,
                        }
                    ]
                },
            },
        )
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=db,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
        )
        server.converter.bind_request(thread=thread, context=context)

        user_message = UserMessageItem(
            id="msg_expired_image",
            thread_id=thread_id,
            created_at=datetime.now(UTC),
            content=[
                UserMessageTextContent(text="Please revisit @expired.png."),
                UserMessageTagContent(
                    id=f"thread-image:{response.stored_file.id}",
                    text="expired.png",
                    data={
                        "entity_type": "thread_image",
                        "file_id": response.stored_file.id,
                        "attachment_id": "attachment_expired_1",
                    },
                    interactive=True,
                ),
            ],
            attachments=[],
            quoted_text=None,
            inference_options=InferenceOptions(),
        )

        input_items = await server.converter.to_agent_input([user_message])
        contents = _flatten_message_contents(input_items)

        assert not any(content.get("type") == "input_image" for content in contents)
        assert any(
            "reattach it if visual inspection is still needed" in str(content.get("text", ""))
            for content in contents
            if content.get("type") == "input_text"
        )


@pytest.mark.anyio
async def test_memory_store_delete_attachment_removes_thread_image_ref(
    initialized_db: None,
) -> None:
    user_id = f"user_delete_ref_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="delete-me.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_delete_ref_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )
        await DatabaseMemoryStore(db).bind_attachment_to_thread(
            attachment_id="attachment_delete_ref_1",
            thread_id=thread_id,
        )

        chat = await db.get(WorkspaceChat, thread_id)
        assert chat is not None
        chat.metadata_json = {
            "workspace_state": {
                "version": "v4",
                "workspace_id": workspace_id,
                "workspace_name": "PlodAI workspace",
                "app_id": "plodai",
                "active_chat_id": thread_id,
                "items": [],
            },
            "plodai_state": {
                "thread_image_refs": [
                    {
                        "stored_file_id": response.stored_file.id,
                        "attachment_id": "attachment_delete_ref_1",
                        "name": "delete-me.png",
                        "mime_type": "image/png",
                        "width": 12,
                        "height": 8,
                    }
                ]
            },
        }
        await db.commit()

        store = DatabaseMemoryStore(
            db,
            openai_client=_StubOpenAIClient(),
        )
        await store.delete_attachment("attachment_delete_ref_1", context=None)

        refreshed_chat = await db.get(WorkspaceChat, thread_id)
        refreshed_record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert refreshed_chat is not None
        assert "plodai_state" not in refreshed_chat.metadata_json
        assert refreshed_record is not None
        assert refreshed_record.status == "deleted"


@pytest.mark.anyio
async def test_thread_item_storage_keeps_canonical_attachment_and_load_hydrates_preview(
    initialized_db: None,
) -> None:
    user_id = f"user_thread_item_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="thread-item.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_thread_item_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        store = DatabaseMemoryStore(
            db,
            openai_client=service.openai_client,
        )
        await store.bind_attachment_to_thread(
            attachment_id="attachment_thread_item_1",
            thread_id=thread_id,
        )
        display_attachment = await store.load_attachment(
            "attachment_thread_item_1",
            context=None,
            hydrate_preview=True,
        )
        assert isinstance(display_attachment, ImageAttachment)

        message = UserMessageItem(
            id="msg_thread_item_preview",
            thread_id=thread_id,
            created_at=datetime.now(UTC),
            content=[UserMessageTextContent(text="Look at this photo.")],
            attachments=[display_attachment],
            quoted_text=None,
            inference_options=InferenceOptions(),
        )
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=db,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
        )

        await store.add_thread_item(thread_id, message, context)

        stored_entry = await db.get(WorkspaceChatEntry, message.id)
        assert stored_entry is not None
        stored_payload = stored_entry.payload
        assert stored_payload["attachments"][0]["type"] == "file"
        assert "preview_url" not in stored_payload["attachments"][0]

        loaded_item = await store.load_item(thread_id, message.id, context)
        loaded_attachment = loaded_item.attachments[0]
        assert isinstance(loaded_attachment, ImageAttachment)
        _assert_signed_preview_url(str(loaded_attachment.preview_url))
        assert loaded_attachment.metadata["stored_file_id"] == response.stored_file.id


@pytest.mark.anyio
async def test_process_new_thread_item_streams_display_image_attachment_but_stores_canonical_payload(
    initialized_db: None,
) -> None:
    user_id = f"user_streamed_thread_item_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"
    thread_id = f"thread_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
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

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=get_settings(),
        )
        upload = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="streamed-preview.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_streamed_preview_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
            public_base_url="http://testserver",
        )

        store = DatabaseMemoryStore(
            db,
            public_base_url="http://testserver",
            openai_client=service.openai_client,
        )
        canonical_attachment = await store.load_attachment(
            "attachment_streamed_preview_1",
            context=None,
        )
        assert isinstance(canonical_attachment, FileAttachment)

        item = UserMessageItem(
            id="msg_streamed_preview",
            thread_id=thread_id,
            created_at=datetime.now(UTC),
            content=[UserMessageTextContent(text="Stream this image.")],
            attachments=[canonical_attachment],
            quoted_text=None,
            inference_options=InferenceOptions(),
        )
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=db,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
        )
        stream = server._process_new_thread_item_respond(thread=ThreadMetadata(
            id=thread_id,
            title="PlodAI",
            created_at=datetime.now(UTC),
            status={"type": "active"},
            metadata={},
        ), item=item, context=context)
        first_event = await stream.__anext__()
        await stream.aclose()

        assert isinstance(first_event, ThreadItemDoneEvent)
        streamed_attachment = first_event.item.attachments[0]
        assert isinstance(streamed_attachment, ImageAttachment)
        _assert_signed_preview_url(str(streamed_attachment.preview_url))
        assert streamed_attachment.thread_id == thread_id
        assert streamed_attachment.metadata["stored_file_id"] == upload.stored_file.id

        stored_entry = await db.get(WorkspaceChatEntry, item.id)
        assert stored_entry is not None
        stored_payload = stored_entry.payload
        assert stored_payload["attachments"][0]["type"] == "file"
        assert "preview_url" not in stored_payload["attachments"][0]


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
                app_id="plodai",
                name="PlodAI workspace",
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
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_preview_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
        )

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        preview_url = service.build_public_preview_url(record, public_base_url="http://localhost")
        token = preview_url.split("token=", 1)[1]

        preview_record = await service.get_preview_file(
            file_id=response.stored_file.id,
            token=token,
        )
        assert preview_record.id == response.stored_file.id


@pytest.mark.anyio
async def test_public_preview_url_prefers_configured_public_base_url(
    initialized_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = f"user_preview_base_url_{uuid4().hex}"
    workspace_id = f"workspace_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="plodai",
                name="PlodAI workspace",
            )
        )
        await db.commit()

        settings = get_settings()
        monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://public.example/base/")

        service = StoredFileService(
            db,
            openai_client=_StubOpenAIClient(),
            settings=settings,
        )
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="public-origin.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id="attachment_public_origin_1",
            scope="chat_attachment",
            thread_id=None,
            create_attachment=True,
            public_base_url="http://internal-host",
        )

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        preview_url = service.build_public_preview_url(
            record,
            public_base_url="http://internal-host",
        )

        assert preview_url.startswith(
            f"https://public.example/base/api/stored-files/{record.id}/preview?token="
        )


@pytest.mark.anyio
async def test_document_thread_upload_accepts_browser_pdf_preview_metadata(
    initialized_db: None,
) -> None:
    user_id = f"user_documents_{uuid4().hex}"
    workspace_id = f"workspace_documents_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="documents",
                name="Documents workspace",
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
            app_id="documents",
            file_name="packet.pdf",
            mime_type="application/pdf",
            file_bytes=b"%PDF-1.7 browser-generated packet",
            attachment_id="",
            scope="document_thread_file",
            thread_id=None,
            create_attachment=False,
            source_kind="derived",
            parent_file_id="file_parent_123",
            preview_json={"kind": "pdf", "page_count": 7},
        )

        assert response.thread_id is not None
        assert response.stored_file.scope == "document_thread_file"
        assert response.stored_file.source_kind == "derived"
        assert response.stored_file.parent_file_id == "file_parent_123"
        assert response.stored_file.preview.kind == "pdf"
        assert response.stored_file.preview.page_count == 7

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        assert record.preview_json == {"kind": "pdf", "page_count": 7}


@pytest.mark.anyio
async def test_document_thread_pdf_upload_defaults_to_empty_preview_without_browser_metadata(
    initialized_db: None,
) -> None:
    user_id = f"user_documents_{uuid4().hex}"
    workspace_id = f"workspace_documents_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="documents",
                name="Documents workspace",
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
            app_id="documents",
            file_name="packet.pdf",
            mime_type="application/pdf",
            file_bytes=b"%PDF-1.7 upload without preview",
            attachment_id="",
            scope="document_thread_file",
            thread_id=None,
            create_attachment=False,
        )

        assert response.stored_file.preview.kind == "empty"

        record = await db.get(StoredOpenAIFile, response.stored_file.id)
        assert record is not None
        assert record.preview_json == {"kind": "empty"}


@pytest.mark.anyio
async def test_document_thread_upload_rejects_mismatched_preview_metadata(
    initialized_db: None,
) -> None:
    user_id = f"user_documents_{uuid4().hex}"
    workspace_id = f"workspace_documents_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        db.add(
            Workspace(
                id=workspace_id,
                user_id=user_id,
                app_id="documents",
                name="Documents workspace",
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
                app_id="documents",
                file_name="packet.pdf",
                mime_type="application/pdf",
                file_bytes=b"%PDF-1.7 upload with wrong preview",
                attachment_id="",
                scope="document_thread_file",
                thread_id=None,
                create_attachment=False,
                preview_json={
                    "kind": "dataset",
                    "row_count": 1,
                    "columns": ["value"],
                    "numeric_columns": ["value"],
                },
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "preview_json did not match the uploaded file kind."


def test_two_phase_chatkit_attachment_upload_endpoint_finalizes_attachment(
    initialized_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = f"user_two_phase_{uuid4().hex}"
    workspace_id = f"workspace_two_phase_{uuid4().hex}"
    image_bytes = _build_test_image_bytes()
    openai_client = _StubOpenAIClient()
    monkeypatch.setattr(
        "backend.app.services.stored_file_service.AsyncOpenAI",
        lambda **_: openai_client,
    )
    monkeypatch.setattr(
        "backend.app.chatkit.memory_store.AsyncOpenAI",
        lambda **_: openai_client,
    )

    with TestClient(app) as client:
        attachment_id, token = asyncio.run(
            _create_pending_attachment(
                user_id=user_id,
                workspace_id=workspace_id,
                image_bytes=image_bytes,
            )
        )
        response = client.post(
            f"/api/chatkit/attachments/{attachment_id}/content",
            params={"token": token},
            content=image_bytes,
            headers={"content-type": "image/png"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == attachment_id
    assert payload["type"] == "image"
    _assert_signed_preview_url(str(payload["preview_url"]))
    assert "upload_descriptor" not in payload

    async def _verify_finalized_attachment() -> None:
        async with AsyncSessionLocal() as db:
            stored_file_result = await db.execute(
                select(StoredOpenAIFile).where(
                    StoredOpenAIFile.attachment_id == attachment_id
                )
            )
            stored_file_row = stored_file_result.scalar_one_or_none()
            assert stored_file_row is not None

            store = DatabaseMemoryStore(
                db,
                openai_client=openai_client,
            )
            attachment = await store.load_attachment(
                attachment_id,
                context=None,
            )
            assert isinstance(attachment, FileAttachment)
            assert attachment.upload_descriptor is None
            metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
            assert metadata.get("openai_file_id")
            assert metadata.get("stored_file_id")

            hydrated_attachment = await store.load_attachment(
                attachment_id,
                context=None,
                hydrate_preview=True,
            )
            assert isinstance(hydrated_attachment, ImageAttachment)
            _assert_signed_preview_url(str(hydrated_attachment.preview_url))

    asyncio.run(_verify_finalized_attachment())


def test_stored_file_preview_route_returns_image_bytes_with_chatkit_cors(
    initialized_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = f"user_preview_route_{uuid4().hex}"
    workspace_id = f"workspace_preview_route_{uuid4().hex}"
    image_bytes = _build_test_image_bytes()
    openai_client = _StubOpenAIClient()
    monkeypatch.setattr(
        "backend.app.services.stored_file_service.AsyncOpenAI",
        lambda **_: openai_client,
    )

    async def _create_uploaded_file() -> str:
        async with AsyncSessionLocal() as db:
            db.add(
                Workspace(
                    id=workspace_id,
                    user_id=user_id,
                    app_id="plodai",
                    name="PlodAI workspace",
                )
            )
            await db.commit()

            service = StoredFileService(
                db,
                openai_client=openai_client,
                settings=get_settings(),
            )
            response = await service.create_chat_attachment_upload(
                user_id=user_id,
                workspace_id=workspace_id,
                app_id="plodai",
                file_name="preview-route.png",
                mime_type="image/png",
                file_bytes=image_bytes,
                attachment_id="attachment_preview_route_1",
                scope="chat_attachment",
                thread_id=None,
                create_attachment=True,
                public_base_url="http://testserver",
            )
            record = await db.get(StoredOpenAIFile, response.stored_file.id)
            assert record is not None
            return service.build_public_preview_url(
                record,
                public_base_url="http://testserver",
            )

    preview_url = asyncio.run(_create_uploaded_file())
    parsed_preview_url = urlparse(preview_url)

    with TestClient(app) as client:
        response = client.get(
            f"{parsed_preview_url.path}?{parsed_preview_url.query}",
            headers={"Origin": "https://cdn.platform.openai.com"},
        )

    assert response.status_code == 200
    assert response.content == image_bytes
    assert response.headers["content-type"] == "image/png"
    assert response.headers["access-control-allow-origin"] == "https://cdn.platform.openai.com"


def test_two_phase_chatkit_attachment_upload_endpoint_accepts_multipart_uploads(
    initialized_db: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = f"user_two_phase_multipart_{uuid4().hex}"
    workspace_id = f"workspace_two_phase_multipart_{uuid4().hex}"
    image_bytes = _build_test_image_bytes()
    monkeypatch.setattr(
        "backend.app.services.stored_file_service.AsyncOpenAI",
        lambda **_: _StubOpenAIClient(),
    )

    with TestClient(app) as client:
        attachment_id, token = asyncio.run(
            _create_pending_attachment(
                user_id=user_id,
                workspace_id=workspace_id,
                image_bytes=image_bytes,
            )
        )
        response = client.post(
            f"/api/chatkit/attachments/{attachment_id}/content",
            params={"token": token},
            files={"file": ("orchard.png", image_bytes, "image/png")},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == attachment_id
    assert payload["type"] == "image"
    _assert_signed_preview_url(str(payload["preview_url"]))
    assert "upload_descriptor" not in payload


def test_two_phase_chatkit_attachment_upload_endpoint_rejects_empty_body(
    initialized_db: None,
) -> None:
    user_id = f"user_two_phase_empty_{uuid4().hex}"
    workspace_id = f"workspace_two_phase_empty_{uuid4().hex}"
    with TestClient(app) as client:
        attachment_id, token = asyncio.run(
            _create_pending_attachment(
                user_id=user_id,
                workspace_id=workspace_id,
                image_bytes=_build_test_image_bytes(),
            )
        )
        response = client.post(
            f"/api/chatkit/attachments/{attachment_id}/content",
            params={"token": token},
            content=b"",
            headers={"content-type": "image/png"},
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "Attachment upload body is required."}


def test_two_phase_chatkit_attachment_upload_endpoint_rejects_size_mismatch(
    initialized_db: None,
) -> None:
    user_id = f"user_two_phase_mismatch_{uuid4().hex}"
    workspace_id = f"workspace_two_phase_mismatch_{uuid4().hex}"
    image_bytes = _build_test_image_bytes()
    with TestClient(app) as client:
        attachment_id, token = asyncio.run(
            _create_pending_attachment(
                user_id=user_id,
                workspace_id=workspace_id,
                image_bytes=image_bytes,
            )
        )
        response = client.post(
            f"/api/chatkit/attachments/{attachment_id}/content",
            params={"token": token},
            files={"file": ("orchard.png", image_bytes + b"extra", "image/png")},
        )

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Attachment upload size did not match the initialized file metadata."
    }
