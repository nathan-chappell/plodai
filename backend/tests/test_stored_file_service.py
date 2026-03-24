from __future__ import annotations

import asyncio
import io
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from chatkit.types import (
    ActiveStatus,
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
from fastapi.testclient import TestClient

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.server import ClientWorkspaceChatKitServer
from backend.app.core.auth import AuthenticatedUser, require_current_user
from backend.app.db.session import AsyncSessionLocal
from backend.app.main import app
from backend.app.models.chatkit import WorkspaceChat, WorkspaceWorkspaceChatAttachment
from backend.app.models.stored_file import StoredFile
from backend.app.models.workspace import Workspace
from backend.app.services.bucket_storage import DEFAULT_STORAGE_PROVIDER
from backend.app.services.stored_file_service import StoredFileService
from backend.tests.fake_bucket_storage import (
    FakeBucketStorage,
    fake_bucket_service_factory,
)


def _build_test_image_bytes() -> bytes:
    from PIL import Image

    image = Image.new("RGB", (12, 8), color=(126, 171, 119))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_test_pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def _build_context(
    *,
    db,
    user_id: str,
    workspace_id: str,
    thread_id: str,
) -> ReportAgentContext:
    return ReportAgentContext(
        report_id=thread_id,
        user_id=user_id,
        user_email=None,
        db=db,
        workspace_id=workspace_id,
    )


def _build_thread_metadata(
    *,
    thread_id: str,
    workspace_id: str,
    workspace_name: str,
    app_id: str,
    openai_conversation_id: str | None = None,
    thread_image_refs: list[dict[str, object]] | None = None,
) -> ThreadMetadata:
    metadata: dict[str, object] = {
        "workspace_state": {
            "version": "v4",
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "app_id": app_id,
            "active_chat_id": thread_id,
            "items": [],
        }
    }
    if isinstance(openai_conversation_id, str) and openai_conversation_id.strip():
        metadata["openai_conversation_id"] = openai_conversation_id.strip()
    if thread_image_refs:
        metadata["plodai_state"] = {
            "thread_image_refs": thread_image_refs,
        }
    return ThreadMetadata(
        id=thread_id,
        title=workspace_name,
        created_at=datetime.now(UTC),
        status=ActiveStatus(type="active"),
        allowed_image_domains=None,
        metadata=metadata,
    )


async def _create_workspace(
    *,
    db,
    user_id: str,
    workspace_id: str,
    app_id: str,
    name: str,
    active_chat_id: str | None = None,
) -> None:
    db.add(
        Workspace(
            id=workspace_id,
            user_id=user_id,
            app_id=app_id,
            name=name,
            active_chat_id=active_chat_id,
        )
    )
    await db.commit()


async def _create_chat(
    *,
    db,
    user_id: str,
    workspace_id: str,
    thread_id: str,
    title: str,
    metadata_json: dict[str, object] | None = None,
) -> None:
    db.add(
        WorkspaceChat(
            id=thread_id,
            user_id=user_id,
            workspace_id=workspace_id,
            title=title,
            metadata_json=metadata_json or {},
            status_json={"type": "active"},
            allowed_image_domains_json=None,
            updated_sequence=1,
        )
    )
    await db.commit()


async def _load_attachment_for_storage(
    *,
    db,
    attachment_id: str,
    context: ReportAgentContext,
    bucket: FakeBucketStorage,
):
    return await DatabaseMemoryStore(
        db,
        public_base_url="http://testserver",
        bucket_service=bucket,
    ).load_attachment(
        attachment_id,
        context=context,
        hydrate_preview=False,
    )


@pytest.fixture
def fake_bucket(monkeypatch: pytest.MonkeyPatch) -> FakeBucketStorage:
    bucket = FakeBucketStorage()
    factory = fake_bucket_service_factory(bucket)

    import backend.app.chatkit.memory_store as memory_store_module
    import backend.app.chatkit.server as server_module
    import backend.app.main as main_module
    import backend.app.services.stored_file_service as stored_file_service_module

    monkeypatch.setattr(
        stored_file_service_module,
        "RailwayBucketService",
        factory,
    )
    monkeypatch.setattr(memory_store_module, "RailwayBucketService", factory)
    monkeypatch.setattr(server_module, "RailwayBucketService", factory)
    monkeypatch.setattr(main_module, "RailwayBucketService", factory)
    return bucket


@pytest.fixture
def route_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=f"user_route_{uuid4().hex}",
        email="route@test.local",
        full_name="Route Test",
        role="admin",
        is_active=True,
        credit_floor_usd=0.0,
    )


@pytest.fixture
def override_current_user(route_user: AuthenticatedUser):
    async def _override() -> AuthenticatedUser:
        return route_user

    app.dependency_overrides[require_current_user] = _override
    yield route_user
    app.dependency_overrides.pop(require_current_user, None)


@pytest.mark.anyio
async def test_memory_store_create_attachment_returns_bucket_put_descriptor(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
) -> None:
    user_id = f"user_memory_store_{uuid4().hex}"
    workspace_id = f"workspace_memory_store_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            name="PlodAI workspace",
        )

        store = DatabaseMemoryStore(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        attachment = await store.create_attachment(
            AttachmentCreateParams(
                name="orchard.png",
                size=len(_build_test_image_bytes()),
                mime_type="image/png",
            ),
            _build_context(
                db=db,
                user_id=user_id,
                workspace_id=workspace_id,
                thread_id="pending_thread",
            ),
        )

        assert isinstance(attachment, FileAttachment)
        assert attachment.id.startswith("atc_")
        assert attachment.upload_descriptor is not None
        assert attachment.upload_descriptor.method == "PUT"
        assert str(attachment.upload_descriptor.url).startswith("https://bucket.test/chat_attachment/")
        assert attachment.upload_descriptor.headers == {"Content-Type": "image/png"}
        assert attachment.metadata == {
            "user_id": user_id,
            "workspace_id": workspace_id,
            "app_id": "plodai",
            "declared_size": len(_build_test_image_bytes()),
            "storage_provider": DEFAULT_STORAGE_PROVIDER,
            "storage_key": attachment.metadata["storage_key"],
            "scope": "chat_attachment",
            "attach_mode": "model_input",
            "input_kind": "image",
            "upload_state": "pending",
        }


@pytest.mark.anyio
async def test_streamed_user_message_event_hydrates_preview_and_persists_canonical_attachment(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
) -> None:
    user_id = f"user_stream_{uuid4().hex}"
    workspace_id = f"workspace_stream_{uuid4().hex}"
    thread_id = f"thread_stream_{uuid4().hex}"
    image_bytes = _build_test_image_bytes()

    async with AsyncSessionLocal() as db:
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            name="PlodAI workspace",
            active_chat_id=thread_id,
        )
        await _create_chat(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            title="PlodAI",
        )

        context = _build_context(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
        )
        store = DatabaseMemoryStore(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        attachment = await store.create_attachment(
            AttachmentCreateParams(
                name="orchard.png",
                size=len(image_bytes),
                mime_type="image/png",
            ),
            context,
        )
        await store.save_attachment(attachment, context=None)
        assert attachment.upload_descriptor is not None
        await fake_bucket.upload_from_presigned_descriptor(
            descriptor_url=str(attachment.upload_descriptor.url),
            file_bytes=image_bytes,
            mime_type="image/png",
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        thread = _build_thread_metadata(
            thread_id=thread_id,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
            app_id="plodai",
        )
        item = UserMessageItem(
            id=f"msg_{uuid4().hex}",
            thread_id=thread_id,
            created_at=datetime.now(UTC),
            content=[UserMessageTextContent(text="Please inspect this image.")],
            attachments=[attachment],
            quoted_text=None,
            inference_options=InferenceOptions(),
        )

        event_stream = server._process_new_thread_item_respond(thread, item, context)
        event = await anext(event_stream)
        await event_stream.aclose()

        assert isinstance(event, ThreadItemDoneEvent)
        display_attachment = event.item.attachments[0]
        assert isinstance(display_attachment, ImageAttachment)
        assert str(display_attachment.preview_url).startswith("https://bucket.test/chat_attachment/")

        attachment_row = await db.get(WorkspaceWorkspaceChatAttachment, attachment.id)
        assert attachment_row is not None
        assert attachment_row.payload["type"] == "file"
        assert "preview_url" not in attachment_row.payload
        stored_file_id = attachment_row.payload["metadata"]["stored_file_id"]
        record = await db.get(StoredFile, stored_file_id)
        assert record is not None
        assert record.storage_provider == DEFAULT_STORAGE_PROVIDER
        assert record.storage_key in fake_bucket.objects

        stored_attachment = await store.load_attachment(
            attachment.id,
            context=context,
            hydrate_preview=False,
        )
        hydrated_attachment = await store.load_attachment(
            attachment.id,
            context=context,
            hydrate_preview=True,
        )
        assert isinstance(stored_attachment, FileAttachment)
        assert isinstance(hydrated_attachment, ImageAttachment)


@pytest.mark.anyio
async def test_attachment_to_message_content_uses_inline_bucket_bytes(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
) -> None:
    user_id = f"user_inline_{uuid4().hex}"
    image_workspace_id = f"workspace_image_{uuid4().hex}"
    file_workspace_id = f"workspace_file_{uuid4().hex}"
    image_thread_id = f"thread_image_{uuid4().hex}"
    file_thread_id = f"thread_file_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=image_workspace_id,
            app_id="plodai",
            name="PlodAI workspace",
        )
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=file_workspace_id,
            app_id="documents",
            name="Documents workspace",
        )

        service = StoredFileService(db, bucket_service=fake_bucket)
        image_response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=image_workspace_id,
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id=f"atc_{uuid4().hex}",
            scope="chat_attachment",
            thread_id=image_thread_id,
            create_attachment=True,
        )
        file_response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=file_workspace_id,
            app_id="documents",
            file_name="notes.pdf",
            mime_type="application/pdf",
            file_bytes=_build_test_pdf_bytes(),
            attachment_id=f"atc_{uuid4().hex}",
            scope="chat_attachment",
            thread_id=file_thread_id,
            create_attachment=True,
        )

        image_context = _build_context(
            db=db,
            user_id=user_id,
            workspace_id=image_workspace_id,
            thread_id=image_thread_id,
        )
        file_context = _build_context(
            db=db,
            user_id=user_id,
            workspace_id=file_workspace_id,
            thread_id=file_thread_id,
        )
        image_attachment = await _load_attachment_for_storage(
            db=db,
            attachment_id=image_response.attachment.id,  # type: ignore[union-attr]
            context=image_context,
            bucket=fake_bucket,
        )
        file_attachment = await _load_attachment_for_storage(
            db=db,
            attachment_id=file_response.attachment.id,  # type: ignore[union-attr]
            context=file_context,
            bucket=fake_bucket,
        )

        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        image_content = await server.converter.attachment_to_message_content(image_attachment)
        file_content = await server.converter.attachment_to_message_content(file_attachment)

        assert image_content["type"] == "input_image"
        assert image_content["image_url"].startswith("data:image/png;base64,")
        assert file_content["type"] == "input_file"
        assert isinstance(file_content["file_data"], str)
        assert file_content["file_data"]
        assert file_content["filename"] == "notes.pdf"
        assert "file_id" not in file_content


@pytest.mark.anyio
async def test_thread_image_tags_use_text_only_reference_when_context_is_live(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
) -> None:
    user_id = f"user_tag_{uuid4().hex}"
    workspace_id = f"workspace_tag_{uuid4().hex}"
    thread_id = f"thread_tag_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            name="PlodAI workspace",
            active_chat_id=thread_id,
        )
        await _create_chat(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            title="PlodAI",
        )

        service = StoredFileService(db, bucket_service=fake_bucket)
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id=f"atc_{uuid4().hex}",
            scope="chat_attachment",
            thread_id=thread_id,
            create_attachment=True,
        )
        stored_file_id = response.stored_file.id
        attachment_id = response.attachment.id  # type: ignore[union-attr]
        thread = _build_thread_metadata(
            thread_id=thread_id,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
            app_id="plodai",
            openai_conversation_id="conv_live",
            thread_image_refs=[
                {
                    "stored_file_id": stored_file_id,
                    "attachment_id": attachment_id,
                    "name": "orchard.png",
                    "mime_type": "image/png",
                    "width": 12,
                    "height": 8,
                }
            ],
        )
        context = _build_context(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
        )
        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        server.converter.bind_request(thread=thread, context=context)

        content = await server.converter.tag_to_message_content(
            UserMessageTagContent(
                id=f"tag_{uuid4().hex}",
                text="orchard",
                data={
                    "entity_type": "thread_image",
                    "stored_file_id": stored_file_id,
                    "attachment_id": attachment_id,
                },
            )
        )

        assert content["type"] == "input_text"
        assert "already part of this thread context" in content["text"]


@pytest.mark.anyio
async def test_thread_image_tags_require_reattachment_when_live_context_is_missing(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
) -> None:
    user_id = f"user_tag_reset_{uuid4().hex}"
    workspace_id = f"workspace_tag_reset_{uuid4().hex}"
    thread_id = f"thread_tag_reset_{uuid4().hex}"

    async with AsyncSessionLocal() as db:
        await _create_workspace(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            name="PlodAI workspace",
            active_chat_id=thread_id,
        )

        service = StoredFileService(db, bucket_service=fake_bucket)
        response = await service.create_chat_attachment_upload(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="plodai",
            file_name="orchard.png",
            mime_type="image/png",
            file_bytes=_build_test_image_bytes(),
            attachment_id=f"atc_{uuid4().hex}",
            scope="chat_attachment",
            thread_id=thread_id,
            create_attachment=True,
        )
        stored_file_id = response.stored_file.id
        attachment_id = response.attachment.id  # type: ignore[union-attr]
        thread = _build_thread_metadata(
            thread_id=thread_id,
            workspace_id=workspace_id,
            workspace_name="PlodAI workspace",
            app_id="plodai",
            thread_image_refs=[
                {
                    "stored_file_id": stored_file_id,
                    "attachment_id": attachment_id,
                    "name": "orchard.png",
                    "mime_type": "image/png",
                    "width": 12,
                    "height": 8,
                }
            ],
        )
        context = _build_context(
            db=db,
            user_id=user_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
        )
        server = ClientWorkspaceChatKitServer(
            db,
            public_base_url="http://testserver",
            bucket_service=fake_bucket,
        )
        server.converter.bind_request(thread=thread, context=context)

        content = await server.converter.tag_to_message_content(
            UserMessageTagContent(
                id=f"tag_{uuid4().hex}",
                text="orchard",
                data={
                    "entity_type": "thread_image",
                    "stored_file_id": stored_file_id,
                    "attachment_id": attachment_id,
                },
            )
        )

        assert content["type"] == "input_text"
        assert "Ask the user to reattach it" in content["text"]


def test_stored_file_routes_redirect_to_bucket_and_configure_cors(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
    override_current_user: AuthenticatedUser,
) -> None:
    user = override_current_user
    workspace_id = f"workspace_route_{uuid4().hex}"
    attachment_id = f"atc_{uuid4().hex}"

    async def _prepare() -> tuple[str, str]:
        async with AsyncSessionLocal() as db:
            await _create_workspace(
                db=db,
                user_id=user.id,
                workspace_id=workspace_id,
                app_id="plodai",
                name="PlodAI workspace",
            )
            service = StoredFileService(db, bucket_service=fake_bucket)
            upload = await service.create_chat_attachment_upload(
                user_id=user.id,
                workspace_id=workspace_id,
                app_id="plodai",
                file_name="orchard.png",
                mime_type="image/png",
                file_bytes=_build_test_image_bytes(),
                attachment_id=attachment_id,
                scope="chat_attachment",
                thread_id=None,
                create_attachment=True,
            )
            token = service._build_preview_token(  # noqa: SLF001 - testing redirect compatibility
                await service.get_stored_file(
                    user_id=user.id,
                    file_id=upload.stored_file.id,
                )
            )
            return upload.stored_file.id, token

    stored_file_id, preview_token = asyncio.run(_prepare())

    with TestClient(app) as client:
        content_response = client.get(
            f"/api/stored-files/{stored_file_id}/content",
            follow_redirects=False,
        )
        preview_response = client.get(
            f"/api/stored-files/{stored_file_id}/preview?token={preview_token}",
            follow_redirects=False,
        )
        deprecated_response = client.post(
            f"/api/chatkit/attachments/{attachment_id}/content?token=legacy",
        )

    assert fake_bucket.ensured_cors_origins
    assert "https://cdn.platform.openai.com" in fake_bucket.ensured_cors_origins[0]
    assert "https://platform.openai.com" in fake_bucket.ensured_cors_origins[0]

    assert content_response.status_code == 307
    assert content_response.headers["location"].startswith("https://bucket.test/")
    assert "kind=get" in content_response.headers["location"]

    assert preview_response.status_code == 307
    assert preview_response.headers["location"].startswith("https://bucket.test/")
    assert "kind=get" in preview_response.headers["location"]

    assert deprecated_response.status_code == 410
    assert "upload directly to storage" in deprecated_response.json()["detail"]


def test_chatkit_attachment_upload_route_writes_document_file_to_bucket(
    initialized_db: None,
    fake_bucket: FakeBucketStorage,
    override_current_user: AuthenticatedUser,
) -> None:
    user = override_current_user
    workspace_id = f"workspace_upload_{uuid4().hex}"

    async def _prepare() -> None:
        async with AsyncSessionLocal() as db:
            await _create_workspace(
                db=db,
                user_id=user.id,
                workspace_id=workspace_id,
                app_id="documents",
                name="Documents workspace",
            )

    asyncio.run(_prepare())

    with TestClient(app) as client:
        response = client.post(
            "/api/chatkit/attachments/upload",
            files={
                "file": (
                    "handbook.pdf",
                    _build_test_pdf_bytes(),
                    "application/pdf",
                )
            },
            data={
                "workspace_id": workspace_id,
                "app_id": "documents",
                "scope": "document_thread_file",
                "create_attachment": "false",
                "source_kind": "upload",
                "preview_json": '{"kind":"pdf","page_count":1}',
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["attachment"] is None
    assert payload["stored_file"]["storage_provider"] == DEFAULT_STORAGE_PROVIDER
    assert payload["stored_file"]["scope"] == "document_thread_file"
    assert payload["stored_file"]["preview"] == {"kind": "pdf", "page_count": 1}
    assert payload["thread_id"]
    assert payload["stored_file"]["storage_key"] in fake_bucket.objects
