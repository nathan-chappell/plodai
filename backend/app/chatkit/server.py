from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.context import ReportAgentContext
from app.agents.report_analyst import report_analyst
from app.chatkit.memory_store import DatabaseMemoryStore
from app.core.config import get_settings
from app.db.session import get_db

try:
    from chatkit.server import ChatKitServer, stream_agent_response
except ImportError:  # pragma: no cover - exercised once dependency is installed
    ChatKitServer = None
    stream_agent_response = None


class ChatKitFrontendConfig:
    def __init__(self, model: str, tools: list[str], notes: list[str]):
        self.model = model
        self.tools = tools
        self.notes = notes


class ReportFoundryChatKitServer:
    def __init__(self, db: AsyncSession):
        self.settings = get_settings()
        self.db = db
        self.store = DatabaseMemoryStore(db)
        self.frontend_config = ChatKitFrontendConfig(
            model=self.settings.chatkit_default_model,
            tools=[
                "list_accessible_datasets",
                "inspect_dataset_schema",
                "run_aggregate_query",
                "request_chart_render",
                "append_report_section",
            ],
            notes=[
                "Always stream agent responses.",
                "Client is responsible for chart rendering and chart image return.",
                "Conversation persistence uses the main SQLite database.",
                "Interesting per-thread state can live in thread metadata.",
            ],
        )
        self.server = self._build_server()

    def _build_server(self):
        if ChatKitServer is None:
            return None
        return ChatKitServer(store=self.store, respond=self.respond)

    async def build_agent_context(self, request: Request, user_email: str) -> ReportAgentContext:
        payload = await self._request_json(request)
        thread_id = payload.get("threadId") or payload.get("thread_id")
        input_items = payload.get("inputItems") or payload.get("items") or []
        metadata = payload.get("metadata") or {}
        title = metadata.get("title") or payload.get("title") or "New report"
        dataset_ids = list(metadata.get("dataset_ids") or payload.get("dataset_ids") or [])
        chart_cache = dict(metadata.get("chart_cache") or {})

        thread = await self.store.get_or_create_thread(
            user_id=user_email,
            thread_id=thread_id,
            title=title,
            metadata=metadata,
        )
        thread_metadata = dict(thread.get("metadata") or {})
        if dataset_ids and not thread_metadata.get("dataset_ids"):
            thread_metadata["dataset_ids"] = dataset_ids
            thread["metadata"] = thread_metadata
            thread = await self.store.save_thread(thread)
            thread_metadata = dict(thread.get("metadata") or {})

        return ReportAgentContext(
            report_id=thread["id"],
            user_email=user_email,
            db=self.db,
            dataset_ids=list(thread_metadata.get("dataset_ids") or dataset_ids),
            chart_cache=chart_cache,
            thread_metadata=thread_metadata,
        )

    async def handle_request(self, request: Request, user_email: str):
        if self.server is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="chatkit is not installed in the active environment.",
            )

        context = await self.build_agent_context(request, user_email=user_email)
        handler = getattr(self.server, "handle", None) or getattr(self.server, "handle_request", None)
        if handler is None:
            raise RuntimeError("ChatKit server object does not expose a request handler.")
        return await handler(request, context=context)

    async def respond(self, turn_event: Any, context: ReportAgentContext):
        if stream_agent_response is None:
            raise RuntimeError("chatkit is not installed in the active environment.")

        return stream_agent_response(
            agent=report_analyst,
            input=getattr(turn_event, "items", []),
            context=context,
            model=self.settings.chatkit_default_model,
        )

    async def list_threads_for_user(self, user_id: str) -> list[dict]:
        return await self.store.list_threads(user_id=user_id)

    async def _request_json(self, request: Request) -> dict:
        try:
            payload = await request.json()
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}


async def build_chatkit_server(db: AsyncSession = Depends(get_db)) -> ReportFoundryChatKitServer:
    return ReportFoundryChatKitServer(db)
