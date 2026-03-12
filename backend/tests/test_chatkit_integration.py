import asyncio
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

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
) -> tuple[ChatThread | None, list[ChatItem]]:
    async with AsyncSessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
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


def _stream_request(client: TestClient, token: str, body: dict[str, object]) -> list[dict[str, object]]:
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


def _run_chatkit_smoke(
    *, model: str, prompt: str
) -> tuple[str, list[dict[str, object]], ChatThread | None, list[ChatItem]]:
    user_suffix = uuid4().hex[:8]
    email = f"systems-test-{user_suffix}@example.com"
    password = "Systems-Test-Password-123!"
    thread_id: str | None = None

    asyncio.run(_cleanup_user_state(email))
    try:
        with TestClient(app) as client:
            asyncio.run(_create_user(email, password))

            login_response = client.post(
                "/api/auth/login",
                json={"email": email, "password": password},
            )
            assert login_response.status_code == 200
            token = login_response.json()["access_token"]

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
                                    "text": prompt,
                                }
                            ],
                            "attachments": [],
                            "inference_options": {"model": model},
                        }
                    },
                },
            )

            thread_created = next(
                event for event in create_events if event.get("type") == "thread.created"
            )
            thread = thread_created["thread"]
            assert isinstance(thread, dict)
            thread_id = str(thread["id"])

            client_tool_call = next(
                event["item"]
                for event in create_events
                if event.get("type") == "thread.item.done"
                and isinstance(event.get("item"), dict)
                and event["item"].get("type") == "client_tool_call"
                and event["item"].get("name") == "list_attached_csv_files"
            )
            assert isinstance(client_tool_call, dict)

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

        events = [*create_events, *followup_events]
        stored_thread, stored_items = asyncio.run(_load_thread_state(thread_id))
        return email, events, stored_thread, stored_items
    finally:
        asyncio.run(_cleanup_user_state(email))


def test_chatkit_live_smoke(initialized_db: None) -> None:
    _, events, stored_thread, stored_items = _run_chatkit_smoke(
        model="gpt-4.1-mini",
        prompt=(
            "This is a systems test. First call list_attached_csv_files. "
            "After the CSV file list returns, set a concise thread title with name_current_thread, "
            "then reply with a short sentence that includes the exact phrase "
            "SYSTEM TEST SUCCESS."
        ),
    )

    event_types = [str(event.get("type")) for event in events]
    assert "thread.created" in event_types
    assert "thread.item.done" in event_types

    client_tool_calls = [
        event["item"]
        for event in events
        if event.get("type") == "thread.item.done"
        and isinstance(item := event.get("item"), dict)
        and item.get("type") == "client_tool_call"
    ]
    assert any(item.get("name") == "list_attached_csv_files" for item in client_tool_calls)

    assistant_messages = [
        event["item"]
        for event in events
        if event.get("type") == "thread.item.done"
        and isinstance(item := event.get("item"), dict)
        and item.get("type") == "assistant_message"
    ]
    assert assistant_messages
    assistant_text = "\n".join(
        str(content.get("text", ""))
        for message in assistant_messages
        if isinstance(message, dict)
        for content in message.get("content", [])
        if isinstance(content, dict)
    )
    assert "SYSTEM TEST SUCCESS" in assistant_text

    assert stored_thread is not None
    assert stored_thread.title not in {None, "", "New report"}
    assert stored_thread.metadata_json.get("openai_previous_response_id")
    assert stored_thread.metadata_json.get("openai_conversation_id")
    usage = stored_thread.metadata_json.get("usage") or {}
    assert usage.get("input_tokens", 0) > 0
    assert usage.get("output_tokens", 0) > 0
    assert usage.get("estimated_cost_usd", 0.0) > 0
    assert any(item.kind == "assistant_message" for item in stored_items)


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-5.1"])
def test_chatkit_streaming_models(initialized_db: None, model: str) -> None:
    _, events, stored_thread, _ = _run_chatkit_smoke(
        model=model,
        prompt=(
            "Streaming test. First call list_attached_csv_files. "
            "After the CSV file list returns, rename the thread and write two short bullet points about the available CSV file."
        ),
    )

    update_events = [
        event
        for event in events
        if event.get("type") == "thread.item.updated"
        and isinstance(update := event.get("update"), dict)
        and str(update.get("type", "")).startswith("assistant_message.content_part.")
    ]
    assert update_events, f"Expected streamed assistant deltas for {model}"
    assert stored_thread is not None
    assert stored_thread.metadata_json.get("openai_conversation_id")
