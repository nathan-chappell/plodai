from __future__ import annotations

from typing import Any

from agents import WebSearchTool, function_tool
from agents.tool import Tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.types import ProgressUpdateEvent
from pydantic import BaseModel, ConfigDict

from backend.app.agents.context import FarmAgentContext
from backend.app.chatkit.metadata import merge_chat_metadata
from backend.app.schemas.farm import FarmRecordPayload
from backend.app.services.farm_service import FarmService

ChatKitToolContext = ToolContext[ChatKitAgentContext[FarmAgentContext]]


class SaveFarmRecordArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record: FarmRecordPayload


def build_plodai_tools(context: FarmAgentContext) -> list[Tool]:
    farm_service = FarmService(context.db)

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

    @function_tool(name_override="get_farm_record")
    async def get_farm_record_tool(
        ctx: ChatKitToolContext,
    ) -> dict[str, Any]:
        request_context = ctx.context.request_context
        record = await farm_service.get_record(
            user_id=request_context.user_id,
            farm_id=request_context.farm_id,
        )
        request_context.current_record = record
        return {
            "farm_id": request_context.farm_id,
            "record": record.model_dump(mode="json"),
        }

    @function_tool(name_override="save_farm_record")
    async def save_farm_record_tool(
        ctx: ChatKitToolContext,
        record: FarmRecordPayload,
    ) -> dict[str, Any]:
        request_context = ctx.context.request_context
        saved_record = await farm_service.save_record(
            user_id=request_context.user_id,
            farm_id=request_context.farm_id,
            record=record,
        )
        request_context.current_record = saved_record
        request_context.farm_name = saved_record.farm_name
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=f"Saved farm record for {saved_record.farm_name}."
            )
        )
        return {
            "farm_id": request_context.farm_id,
            "record": saved_record.model_dump(mode="json"),
        }

    return [
        name_current_thread_tool,
        get_farm_record_tool,
        save_farm_record_tool,
        WebSearchTool(search_context_size="medium"),
    ]
