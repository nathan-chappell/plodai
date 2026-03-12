import asyncio
import json
from uuid import uuid4

import pytest
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from sqlalchemy import delete, select

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.core.config import get_settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.main import app
from backend.app.models.chatkit import ChatItem, ChatThread
from backend.app.models.user import User
from backend.app.services.auth_service import hash_password

CSV_FILES_PAYLOAD = {
    "csv_files": [
        {
            "id": "sales_csv",
            "name": "Sales dataset",
            "row_count": 4,
            "columns": ["region", "category", "revenue", "units"],
            "numeric_columns": ["revenue", "units"],
            "sample_rows": [
                {
                    "region": "North",
                    "category": "Hardware",
                    "revenue": "120",
                    "units": "4",
                },
                {
                    "region": "South",
                    "category": "Software",
                    "revenue": "240",
                    "units": "6",
                },
            ],
        }
    ]
}


async def _create_user(email: str, password: str) -> None:
    async with AsyncSessionLocal() as db:
        db.add(
            User(
                email=email,
                full_name="Systems Test User",
                password_hash=hash_password(password),
                role="user",
                is_active=True,
            )
        )
        await db.commit()


async def _cleanup_user_state(email: str) -> None:
    async with AsyncSessionLocal() as db:
        thread_ids = list(
            (await db.execute(select(ChatThread.id).where(ChatThread.user_id == email)))
            .scalars()
            .all()
        )
        if thread_ids:
            await db.execute(delete(ChatItem).where(ChatItem.thread_id.in_(thread_ids)))
            await db.execute(delete(ChatThread).where(ChatThread.id.in_(thread_ids)))
        await db.execute(delete(User).where(User.email == email))
        await db.commit()


async def _load_thread_state(
    thread_id: str,
    user_email: str,
) -> tuple[ChatThread | None, list[ChatItem]]:
    async with AsyncSessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
        if thread is None:
            return None, []

        store = DatabaseMemoryStore(db)
        context = ReportAgentContext(report_id=thread_id, user_email=user_email, db=db)
        page = await store.load_thread_items(
            thread_id,
            after=None,
            limit=100,
            order="asc",
            context=context,
        )

        items = list(
            (
                await db.execute(
                    select(ChatItem)
                    .where(ChatItem.thread_id == thread_id)
                    .order_by(ChatItem.sequence.asc())
                )
            )
            .scalars()
            .all()
        )

        assert len(page.data) == len(items), {
            "store_item_types": [item.type for item in page.data],
            "db_item_kinds": [item.kind for item in items],
        }
        return thread, items


def _parse_sse_events(raw_body: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line in raw_body.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line.removeprefix("data: ").strip()
        if not payload:
            continue
        events.append(json.loads(payload))
    return events


def _stream_request(
    client: TestClient, token: str, body: dict[str, object]
) -> list[dict[str, object]]:
    with client.stream(
        "POST",
        "/chatkit",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        raw_body = "".join(response.iter_text())
    return _parse_sse_events(raw_body)


def _login_test_user(client: TestClient, email: str, password: str) -> str:
    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200
    return str(login_response.json()["access_token"])


def test_chatkit_live_smoke(initialized_db: None) -> None:
    user_suffix = uuid4().hex[:8]
    email = f"systems-test-{user_suffix}@example.com"
    password = "Systems-Test-Password-123!"

    asyncio.run(_cleanup_user_state(email))
    try:
        with TestClient(app) as client:
            asyncio.run(_create_user(email, password))
            token = _login_test_user(client, email, password)

            create_events = _stream_request(
                client,
                token,
                {
                    "type": "threads.create",
                    "metadata": {},
                    "params": {
                        "input": {
                            "content": [
                                {
                                    "type": "input_text",
                                    "text": (
                                        "This is a systems test. First call list_attached_csv_files. "
                                        "After the CSV file list returns, set a concise thread title with name_current_thread, "
                                        "then reply with a short sentence that includes the exact phrase SYSTEM TEST SUCCESS."
                                    ),
                                }
                            ],
                            "attachments": [],
                            "inference_options": {"model": "gpt-4.1-mini"},
                        }
                    },
                },
            )
            for event in create_events:
                print(json.dumps(jsonable_encoder(event), indent=2))

            thread_created = next(
                event
                for event in create_events
                if event.get("type") == "thread.created"
            )
            thread = thread_created["thread"]
            assert isinstance(thread, dict)
            thread_id = str(thread["id"])

            stored_thread_after_create, stored_items_after_create = asyncio.run(
                _load_thread_state(thread_id, email)
            )
            assert stored_thread_after_create is not None
            assert stored_items_after_create, create_events

            pending_list_call = next(
                (
                    item
                    for item in stored_items_after_create
                    if item.kind == "client_tool_call"
                    and item.payload.get("name") == "list_attached_csv_files"
                ),
                None,
            )
            assert pending_list_call is not None, {
                "events": create_events,
                "persisted_kinds": [item.kind for item in stored_items_after_create],
                "persisted_payloads": [
                    item.payload for item in stored_items_after_create
                ],
            }
            assert pending_list_call.payload.get("status") == "pending"

            followup_events = _stream_request(
                client,
                token,
                {
                    "type": "threads.add_client_tool_output",
                    "metadata": {},
                    "params": {
                        "thread_id": thread_id,
                        "result": CSV_FILES_PAYLOAD,
                    },
                },
            )

        all_events = [*create_events, *followup_events]
        stored_thread, stored_items = asyncio.run(_load_thread_state(thread_id, email))

        event_types = [str(event.get("type")) for event in all_events]
        assert event_types.count("thread.created") == 1
        assert "thread.item.done" in event_types

        assistant_messages = [
            event["item"]
            for event in followup_events
            if event.get("type") == "thread.item.done"
            and isinstance(item := event.get("item"), dict)
            and item.get("type") == "assistant_message"
        ]
        assert assistant_messages, followup_events
        assistant_text = "\n".join(
            str(content.get("text", ""))
            for message in assistant_messages
            if isinstance(message, dict)
            for content in message.get("content", [])
            if isinstance(content, dict)
        )
        assert assistant_text.strip(), assistant_messages
        assert any(
            marker in assistant_text.lower()
            for marker in ["csv", "file", "inventory", "available", "received"]
        ), assistant_text

        assert stored_thread is not None
        assert stored_thread.id == thread_id
        assert stored_thread.user_id == email
        assert stored_thread.metadata_json.get("openai_previous_response_id")
        assert stored_thread.metadata_json.get("openai_conversation_id")
        usage = stored_thread.metadata_json.get("usage") or {}
        assert usage.get("input_tokens", 0) > 0
        assert usage.get("output_tokens", 0) > 0
        assert usage.get("estimated_cost_usd", 0.0) > 0

        assert stored_items, "Expected persisted thread items"
        persisted_kinds = [item.kind for item in stored_items]
        assert persisted_kinds[0] == "user_message"
        assert "client_tool_call" in persisted_kinds
        assert persisted_kinds[-1] == "assistant_message"

        persisted_list_call = next(
            (
                item
                for item in stored_items
                if item.kind == "client_tool_call"
                and item.payload.get("name") == "list_attached_csv_files"
            ),
            None,
        )
        assert persisted_list_call is not None, [item.payload for item in stored_items]
        assert persisted_list_call.payload.get("status") == "completed"
        assert persisted_list_call.payload.get("output") == CSV_FILES_PAYLOAD
    finally:
        asyncio.run(_cleanup_user_state(email))


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-5.1"])
def test_chatkit_streaming_models(initialized_db: None, model: str) -> None:
    async def run_stream_check() -> None:
        settings = get_settings()
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY or None)

        text_deltas: list[str] = []
        event_types: list[str] = []

        async with client.responses.stream(
            model=model,
            input="Reply with exactly two short bullet points about why streaming tests matter.",
            store=True,
        ) as stream:
            async for event in stream:
                event_type = getattr(event, "type", "")
                event_types.append(str(event_type))
                if event_type == "response.output_text.delta":
                    text_deltas.append(getattr(event, "delta", ""))

            final_response = await stream.get_final_response()

        output_text = "".join(text_deltas).strip()
        assert text_deltas, (
            f"Expected streamed text deltas for {model}, got events: {event_types}"
        )
        assert final_response.id
        assert output_text or getattr(final_response, "output_text", "")

    asyncio.run(run_stream_check())
