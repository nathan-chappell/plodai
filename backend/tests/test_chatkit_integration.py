import asyncio
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from backend.app.db.session import AsyncSessionLocal
from backend.app.main import app
from backend.app.models.chatkit import ChatItem, ChatThread
from backend.app.models.user import User
from backend.app.services.auth_service import hash_password

LIVE_TEST_ENV = "RUN_LIVE_CHATKIT_TEST"


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


def test_chatkit_live_smoke(initialized_db: None) -> None:
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

            request_body = {
                "type": "threads.create",
                "metadata": {
                    "dataset_ids": ["sales_csv"],
                    "datasets": [
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
                    ],
                },
                "params": {
                    "input": {
                        "content": [
                            {
                                "type": "input_text",
                                "text": (
                                    "This is a systems test. Use list_accessible_datasets first, "
                                    "then set a concise thread title with name_current_thread, "
                                    "then reply with a short sentence that includes the exact phrase "
                                    "SYSTEM TEST SUCCESS. Do not call any client-side tools."
                                ),
                            }
                        ],
                        "attachments": [],
                        "inference_options": {"model": "gpt-4.1-mini"},
                    }
                },
            }

            with client.stream(
                "POST",
                "/chatkit",
                json=request_body,
                headers={"Authorization": f"Bearer {token}"},
            ) as response:
                assert response.status_code == 200
                assert response.headers["content-type"].startswith("text/event-stream")
                raw_body = "".join(response.iter_text())

        events = _parse_sse_events(raw_body)
        event_types = [str(event.get("type")) for event in events]
        assert "thread.created" in event_types
        assert "thread.item.done" in event_types

        thread_created = next(
            event for event in events if event.get("type") == "thread.created"
        )
        thread = thread_created["thread"]
        assert isinstance(thread, dict)
        thread_id = str(thread["id"])

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

        stored_thread, stored_items = asyncio.run(_load_thread_state(thread_id))
        assert stored_thread is not None
        assert stored_thread.title not in {None, "", "New report"}
        assert stored_thread.metadata_json.get("openai_previous_response_id")
        assert any(item.kind == "assistant_message" for item in stored_items)
    finally:
        asyncio.run(_cleanup_user_state(email))
