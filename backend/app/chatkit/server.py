from __future__ import annotations

import json
from typing import Any, AsyncIterator, Literal, cast

from agents import Runner
from chatkit.actions import Action
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.agents import ThreadItemConverter, stream_agent_response
from chatkit.server import ChatKitServer
from chatkit.types import (
    Attachment,
    ChatKitReq,
    ClientToolCallItem,
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadItem,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
    WidgetItem,
)
from fastapi import Depends
from openai import AsyncOpenAI
from openai.types.responses import ResponseInputImageParam, ResponseInputTextParam
from openai.types.responses.response_input_item_param import Message
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.report_analyst import build_report_analyst
from backend.app.chatkit.client_tools import (
    ClientToolResultPayload,
    coerce_client_tool_result,
)
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.metadata import (
    ThreadMetadataPatch,
    ThreadDatasetMetadata,
    datasets_from_thread_metadata,
    merge_thread_metadata,
    normalize_thread_metadata,
)
from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger, response_logs_url, summarize_for_log
from backend.app.db.session import get_db


logger = get_logger('chatkit.server')


class ClientToolResultConverter(ThreadItemConverter):
    async def attachment_to_message_content(self, attachment: Attachment):
        raise NotImplementedError(
            'ChatKit attachments are disabled for this app. Files are selected and processed locally, then exposed to the agent through client tools.'
        )

    async def client_tool_call_to_input(self, item: ClientToolCallItem):
        if item.status == 'pending' or item.output is None:
            return None
        return self.client_tool_result_to_input(
            coerce_client_tool_result(item.output),
            tool_name=item.name,
        )

    def client_tool_result_to_input(
        self,
        result: ClientToolResultPayload | None,
        tool_name: str | None = None,
    ) -> Message | None:
        if result is None:
            return None

        image_url = result.get('imageDataUrl') or result.get('image_data_url')
        query_id = result.get('query_id') or result.get('queryId')
        row_count = result.get('row_count')

        description = 'A client-side tool completed successfully.'
        if tool_name:
            description = f"The client tool '{tool_name}' completed successfully."
        if isinstance(query_id, str) and query_id:
            description += f' Query id: {query_id}.'
        if isinstance(row_count, int):
            description += f' Result row count: {row_count}.'
        if isinstance(image_url, str) and image_url:
            description += ' A rendered chart image is attached for visual inspection.'

        content: list[ResponseInputTextParam | ResponseInputImageParam] = [
            ResponseInputTextParam(type='input_text', text=description),
            ResponseInputTextParam(
                type='input_text', text=json.dumps(result, ensure_ascii=True)
            ),
        ]

        if isinstance(image_url, str) and image_url:
            content.append(
                ResponseInputImageParam(
                    type='input_image', image_url=image_url, detail='auto'
                )
            )

        return Message(role='user', type='message', content=list(content))


class UpdateThreadMetadataAction(
    Action[Literal['update_thread_metadata'], ThreadMetadataPatch]
):
    pass


class ReportFoundryChatKitServer(ChatKitServer[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.settings = get_settings()
        self.db = db
        self.openai_client = AsyncOpenAI(api_key=self.settings.openai_api_key or None)
        store = DatabaseMemoryStore(db)
        super().__init__(store=store)
        self.converter = ClientToolResultConverter()
        self.logger = logger

    async def build_request_context(
        self, raw_request: bytes | str, user_email: str
    ) -> ReportAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        metadata = normalize_thread_metadata(parsed_request.metadata)
        thread_id = getattr(parsed_request.params, 'thread_id', None)
        datasets = self._coerce_datasets(metadata.get('datasets') or [])
        dataset_ids = list(
            metadata.get('dataset_ids') or [dataset.id for dataset in datasets]
        )
        chart_cache = dict(metadata.get('chart_cache') or {})
        query_plan_model, query_plan_schema = build_query_plan_model(datasets)

        self.logger.info(
            'request_context.build op=%s thread_id=%s user_email=%s dataset_count=%s',
            parsed_request.type,
            thread_id,
            user_email,
            len(datasets),
        )

        return ReportAgentContext(
            report_id=thread_id or 'pending_thread',
            user_email=user_email,
            db=self.db,
            dataset_ids=dataset_ids,
            chart_cache=chart_cache,
            thread_metadata=metadata,
            available_datasets=datasets,
            query_plan_model=query_plan_model,
            query_plan_schema=query_plan_schema,
        )

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        typed_metadata = normalize_thread_metadata(thread.metadata)
        context.report_id = thread.id
        context.thread_metadata = typed_metadata
        context.chart_cache = dict(typed_metadata.get('chart_cache') or {})
        context.dataset_ids = list(
            typed_metadata.get('dataset_ids') or context.dataset_ids
        )
        if not context.available_datasets:
            context.available_datasets = datasets_from_thread_metadata(typed_metadata)
            context.query_plan_model, context.query_plan_schema = (
                build_query_plan_model(context.available_datasets)
            )

        recent_items = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=20,
            order='desc',
            context=context,
        )
        pending_items = self._collect_pending_items(
            recent_items.data,
            has_openai_conversation=bool(typed_metadata.get('openai_conversation_id')),
        )
        if input_user_message is not None and not any(
            item.id == input_user_message.id for item in pending_items
        ):
            pending_items.append(input_user_message)
        agent_input = await self.converter.to_agent_input(pending_items)
        requested_model = self._resolve_requested_model(
            input_user_message=input_user_message,
            recent_items=recent_items.data,
        )
        conversation_id = typed_metadata.get('openai_conversation_id')
        previous_response_id = typed_metadata.get('openai_previous_response_id')
        if conversation_id is None:
            conversation_id = await self._ensure_openai_conversation(thread, context)

        self.logger.info(
            'respond.start thread_id=%s user_email=%s model=%s pending_items=%s agent_input_items=%s datasets=%s conversation_id=%s previous_response_id=%s',
            thread.id,
            context.user_email,
            requested_model,
            len(pending_items),
            len(agent_input),
            summarize_for_log(context.dataset_ids),
            conversation_id,
            previous_response_id,
        )

        agent = build_report_analyst(context, model=requested_model)
        chatkit_context = ChatKitAgentContext[ReportAgentContext](
            thread=thread, store=self.store, request_context=context
        )
        context.emit_event = chatkit_context.stream

        try:
            result = Runner.run_streamed(
                agent,
                agent_input,
                context=context,
                conversation_id=conversation_id,
            )
            async for event in self._stream_agent_response(chatkit_context, result):
                yield event
        except Exception:
            self.logger.exception(
                'respond.error thread_id=%s user_email=%s conversation_id=%s previous_response_id=%s',
                thread.id,
                context.user_email,
                conversation_id,
                previous_response_id,
            )
            raise

        if context.requested_thread_title:
            thread.title = context.requested_thread_title

        result_conversation_id = getattr(result, 'conversation_id', None) or getattr(
            result, '_conversation_id', None
        ) or conversation_id
        result_response_id = result.last_response_id
        updated_metadata = merge_thread_metadata(
            typed_metadata,
            cast(
                ThreadMetadataPatch,
                {
                    'title': context.requested_thread_title
                    or typed_metadata.get('title'),
                    'openai_conversation_id': result_conversation_id,
                    'openai_previous_response_id': result_response_id,
                    'chart_cache': context.chart_cache,
                    'dataset_ids': context.dataset_ids,
                    'datasets': [
                        self._dataset_to_dict(dataset)
                        for dataset in context.available_datasets
                    ],
                },
            ),
        )
        thread.metadata = dict(updated_metadata)

        self.logger.info(
            'respond.end thread_id=%s user_email=%s conversation_id=%s response_id=%s response_logs=%s title=%s',
            thread.id,
            context.user_email,
            result_conversation_id,
            result_response_id,
            response_logs_url(result_response_id),
            summarize_for_log(context.requested_thread_title or thread.title or ''),
        )

    def _resolve_requested_model(
        self,
        *,
        input_user_message: UserMessageItem | None,
        recent_items: list[ThreadItem],
    ) -> str | None:
        if (
            input_user_message is not None
            and input_user_message.inference_options.model
        ):
            return input_user_message.inference_options.model

        for item in recent_items:
            if item.type == 'user_message' and item.inference_options.model:
                return item.inference_options.model

        return None

    async def _ensure_openai_conversation(
        self,
        thread: ThreadMetadata,
        context: ReportAgentContext,
    ) -> str:
        metadata: dict[str, str] = {
            'app': 'report-foundry',
            'thread_id': thread.id,
            'user_email': context.user_email,
        }
        if context.dataset_ids:
            metadata['dataset_ids'] = ','.join(context.dataset_ids)[:512]
        if thread.title:
            metadata['thread_title'] = thread.title[:512]

        conversation = await self.openai_client.conversations.create(metadata=metadata)
        self.logger.info(
            'respond.conversation_created thread_id=%s user_email=%s conversation_id=%s',
            thread.id,
            context.user_email,
            conversation.id,
        )
        return conversation.id

    def _collect_pending_items(
        self,
        recent_items: list[ThreadItem],
        *,
        has_openai_conversation: bool,
    ) -> list[ThreadItem]:
        chronological_items = list(reversed(recent_items))
        boundary_index = -1
        for index, item in enumerate(chronological_items):
            if item.type in {'assistant_message', 'client_tool_call'}:
                boundary_index = index

        if boundary_index < 0:
            if has_openai_conversation:
                raise RuntimeError(
                    'Unable to recover recent thread context: no previous OpenAI output found in the last 20 thread items.'
                )
            return chronological_items

        boundary_item = chronological_items[boundary_index]
        if boundary_index == len(chronological_items) - 1:
            if (
                boundary_item.type == 'client_tool_call'
                and boundary_item.status == 'completed'
            ):
                return [boundary_item]
            return []

        return chronological_items[boundary_index + 1 :]

    async def _stream_agent_response(
        self, chatkit_context: ChatKitAgentContext[ReportAgentContext], result
    ) -> AsyncIterator[ThreadStreamEvent]:
        async for event in stream_agent_response(chatkit_context, result):
            yield event

    async def action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if action.type == 'update_thread_metadata' and isinstance(action.payload, dict):
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch = cast(ThreadMetadataPatch, action.payload)
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            if title := patch.get('title'):
                thread.title = title
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                'thread_metadata.updated thread_id=%s user_email=%s title=%s',
                thread.id,
                context.user_email,
                summarize_for_log(thread.title or ''),
            )
            yield ProgressUpdateEvent(text='Saved thread metadata update.')
            return

        yield ProgressUpdateEvent(text=f'Unhandled action: {action.type}')

    async def sync_action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: ReportAgentContext,
    ) -> SyncCustomActionResponse:
        if action.type == 'update_thread_metadata' and isinstance(action.payload, dict):
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch = cast(ThreadMetadataPatch, action.payload)
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            if title := patch.get('title'):
                thread.title = title
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                'thread_metadata.sync_updated thread_id=%s user_email=%s title=%s',
                thread.id,
                context.user_email,
                summarize_for_log(thread.title or ''),
            )
        return SyncCustomActionResponse(updated_item=sender)

    async def list_threads_for_user(self, user_email: str):
        context = ReportAgentContext(
            report_id='list', user_email=user_email, db=self.db
        )
        return await self.store.load_threads(
            limit=100, after=None, order='desc', context=context
        )

    def _coerce_datasets(
        self, raw_datasets: list[ThreadDatasetMetadata]
    ) -> list[DatasetMetadata]:
        return [
            DatasetMetadata(
                id=raw_dataset['id'],
                name=raw_dataset['name'],
                columns=list(raw_dataset['columns']),
                sample_rows=[dict(row) for row in raw_dataset['sample_rows']],
                row_count=raw_dataset['row_count'],
                numeric_columns=list(raw_dataset['numeric_columns']),
            )
            for raw_dataset in raw_datasets
            if raw_dataset['id']
        ]

    def _dataset_to_dict(self, dataset: DatasetMetadata) -> ThreadDatasetMetadata:
        return {
            'id': dataset.id,
            'name': dataset.name,
            'columns': dataset.columns,
            'sample_rows': [
                {str(key): str(value) for key, value in row.items()}
                for row in dataset.sample_rows
            ],
            'row_count': dataset.row_count,
            'numeric_columns': dataset.numeric_columns,
        }


async def build_chatkit_server(
    db: AsyncSession = Depends(get_db),
) -> ReportFoundryChatKitServer:
    return ReportFoundryChatKitServer(db)
