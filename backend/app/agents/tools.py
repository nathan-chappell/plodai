from __future__ import annotations

from typing import Any

from agents import WebSearchTool, function_tool
from agents.tool import Tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.types import ClientEffectEvent, ProgressUpdateEvent
from pydantic import BaseModel, ConfigDict

from backend.app.agents.context import AdvisoryAgentContext
from backend.app.chatkit.metadata import merge_chat_metadata
from backend.app.schemas.advisory import AdvisoryRecordPayload
from backend.app.services.advisory_semantic_service import AdvisorySemanticService
from backend.app.services.advisory_service import AdvisoryService

ChatKitToolContext = ToolContext[ChatKitAgentContext[AdvisoryAgentContext]]


class SaveAdvisoryRecordArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record: AdvisoryRecordPayload


def build_plodai_tools(context: AdvisoryAgentContext) -> list[Tool]:
    advisory_service = AdvisoryService(context.db)
    semantic_service = AdvisorySemanticService(context.db, advisory_service=advisory_service)

    @function_tool(name_override="name_current_thread")
    async def name_current_thread_tool(
        ctx: ChatKitToolContext,
        title: str,
    ) -> dict[str, str]:
        cleaned_title = title.strip()
        if not cleaned_title:
            raise ValueError("title must be a non-empty string")

        request_context = ctx.context.request_context
        request_context.thread_title = cleaned_title
        request_context.thread_metadata = merge_chat_metadata(
            request_context.thread_metadata,
            {"title": cleaned_title},
        )
        ctx.context.thread.title = cleaned_title
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Renamed chat to {cleaned_title}.")
        )
        return {
            "chat_id": ctx.context.thread.id,
            "title": cleaned_title,
        }

    @function_tool(name_override="get_advisory_record")
    async def get_advisory_record_tool(
        ctx: ChatKitToolContext,
    ) -> dict[str, Any]:
        request_context = ctx.context.request_context
        record = await advisory_service.get_record(
            user_id=request_context.user_id,
            case_id=request_context.case_id,
        )
        request_context.current_record = record
        return {
            "case_id": request_context.case_id,
            "record": record.model_dump(mode="json"),
        }

    @function_tool(name_override="save_advisory_record")
    async def save_advisory_record_tool(
        ctx: ChatKitToolContext,
        record: AdvisoryRecordPayload,
    ) -> dict[str, Any]:
        request_context = ctx.context.request_context
        saved_record = await advisory_service.save_record(
            user_id=request_context.user_id,
            case_id=request_context.case_id,
            record=record,
        )
        request_context.current_record = saved_record
        request_context.case_title = saved_record.title
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=f"Saved advisory record for {saved_record.title or 'this conversation'}."
            )
        )
        await ctx.context.stream(
            ClientEffectEvent(
                name="advisory_record_updated",
                data={
                    "case_id": request_context.case_id,
                    "case_title": saved_record.title,
                },
            )
        )
        return {
            "case_id": request_context.case_id,
            "record": saved_record.model_dump(mode="json"),
        }

    @function_tool(name_override="search_advisory_memory")
    async def search_advisory_memory_tool(
        ctx: ChatKitToolContext,
        query: str,
        max_results: int = 6,
    ) -> dict[str, Any]:
        cleaned_query = query.strip()
        if not cleaned_query:
            raise ValueError("query must be a non-empty string")
        request_context = ctx.context.request_context
        response = await semantic_service.search_reports_and_queries(
            user_id=request_context.user_id,
            case_id=request_context.case_id,
            query=cleaned_query,
            max_results=max(1, min(max_results, 12)),
        )
        return response.model_dump(mode="json")

    return [
        name_current_thread_tool,
        get_advisory_record_tool,
        save_advisory_record_tool,
        search_advisory_memory_tool,
        WebSearchTool(search_context_size="medium"),
    ]
