import asyncio
from datetime import datetime
from types import SimpleNamespace

from chatkit.types import ImageAttachment, ThreadMetadata, UserMessageTagContent

from backend.app.agents.context import FarmAgentContext
from backend.app.chatkit.server import FarmThreadItemConverter


class FakeImageService:
    async def get_image(
        self,
        *,
        user_id: str,
        farm_id: str,
        image_id: str,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            id=image_id,
            name="orchard.jpg",
            mime_type="image/jpeg",
        )

    async def load_image_bytes(self, image: object) -> bytes:
        return b"test-image-bytes"


def test_attachment_image_inputs_use_high_detail() -> None:
    async def _run() -> None:
        converter = _build_converter()
        attachment = ImageAttachment(
            id="attachment_1",
            name="orchard.jpg",
            mime_type="image/jpeg",
            preview_url="https://example.test/preview.jpg",
            metadata={"image_id": "image_1"},
        )

        content = await converter.attachment_to_message_content(attachment)

        assert _field(content, "type") == "input_image"
        assert _field(content, "detail") == "high"
        assert _field(content, "image_url").startswith("data:image/jpeg;base64,")

    asyncio.run(_run())


def test_tagged_image_inputs_use_high_detail() -> None:
    async def _run() -> None:
        converter = _build_converter()
        tag = UserMessageTagContent(
            id="image_1",
            text="Leaf closeup",
            data={"entity_type": "farm_image", "image_id": "image_1"},
        )

        contents = await converter._farm_image_tag_to_message_contents(
            tag,
            tag_data=tag.data,
            current_attachment_image_ids=set(),
        )

        assert len(contents) == 2
        image_content = contents[1]
        assert _field(image_content, "type") == "input_image"
        assert _field(image_content, "detail") == "high"
        assert _field(image_content, "image_url").startswith("data:image/jpeg;base64,")

    asyncio.run(_run())


def _build_converter() -> FarmThreadItemConverter:
    converter = FarmThreadItemConverter(
        db=SimpleNamespace(),
        bucket_service=SimpleNamespace(),
    )
    converter.image_service = FakeImageService()
    converter.bind_request(
        thread=ThreadMetadata(
            id="thread_1",
            created_at=datetime.now(),
            metadata={},
        ),
        context=FarmAgentContext(
            chat_id="chat_1",
            user_id="user_1",
            user_email="farmer@example.com",
            db=SimpleNamespace(),
            farm_id="farm_1",
            farm_name="Walnut Orchard",
        ),
    )
    return converter


def _field(value: object, key: str) -> str:
    if isinstance(value, dict):
        result = value[key]
    else:
        result = getattr(value, key)
    assert isinstance(result, str)
    return result
