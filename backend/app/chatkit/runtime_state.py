from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.workspace_file import (
    CsvWorkspaceMetadata,
    ImageWorkspaceMetadata,
    JsonWorkspaceMetadata,
    PdfWorkspaceMetadata,
    WorkspaceFileMetadata,
)
from backend.app.chatkit.metadata import (
    AppChatMetadata,
    ChatMetadataPatch,
    WorkspaceItemSummary,
    WorkspaceState,
    merge_chat_metadata,
    parse_chat_metadata,
)
from chatkit.types import ThreadMetadata


@dataclass(kw_only=True)
class ResolvedThreadRuntimeState:
    metadata: AppChatMetadata
    available_files: list[WorkspaceFileMetadata]
    query_plan_model: type[BaseModel]

def _workspace_file_from_workspace_entry(
    item_summary: WorkspaceItemSummary,
) -> WorkspaceFileMetadata | None:
    if item_summary.get("origin") != "upload":
        return None
    kind = item_summary["kind"]
    preview = item_summary.get("preview") or {}

    return WorkspaceFileMetadata(
        id=item_summary["id"],
        name=item_summary["name"],
        kind=kind,
        extension=item_summary.get("extension") or "",
        mime_type=item_summary.get("mime_type"),
        byte_size=item_summary.get("byte_size"),
        csv=(
            CsvWorkspaceMetadata(
                row_count=preview.get("row_count") or 0,
                columns=list(preview.get("columns", [])),
                numeric_columns=list(preview.get("numeric_columns", [])),
                sample_rows=list(preview.get("sample_rows", [])),
            )
            if kind == "csv"
            else None
        ),
        json=(
            JsonWorkspaceMetadata(
                row_count=preview.get("row_count") or 0,
                columns=list(preview.get("columns", [])),
                numeric_columns=list(preview.get("numeric_columns", [])),
                sample_rows=list(preview.get("sample_rows", [])),
            )
            if kind == "json"
            else None
        ),
        pdf=(
            PdfWorkspaceMetadata(page_count=preview.get("page_count"))
            if kind == "pdf"
            else None
        ),
        image=(
            ImageWorkspaceMetadata(
                width=preview.get("width"),
                height=preview.get("height"),
            )
            if kind == "image"
            else None
        ),
    )


def workspace_files_from_workspace_state(
    workspace_state: WorkspaceState | None,
) -> list[WorkspaceFileMetadata]:
    if workspace_state is None:
        return []
    files: list[WorkspaceFileMetadata] = []
    for item_summary in workspace_state.get("items", []):
        file_metadata = _workspace_file_from_workspace_entry(item_summary)
        if file_metadata is not None:
            files.append(file_metadata)
    return files


def build_runtime_metadata_patch(
    *,
    current_metadata: AppChatMetadata,
    request_metadata: AppChatMetadata,
) -> ChatMetadataPatch:
    patch: ChatMetadataPatch = {}

    request_surface_key = request_metadata.get("surface_key")
    if (
        request_surface_key
        and current_metadata.get("surface_key") != request_surface_key
    ):
        patch["surface_key"] = request_surface_key

    request_bundle = request_metadata.get("agent_bundle")
    if (
        request_bundle is not None
        and current_metadata.get("agent_bundle") != request_bundle
    ):
        patch["agent_bundle"] = request_bundle

    request_workspace_state = request_metadata.get("workspace_state")
    if (
        request_workspace_state is not None
        and current_metadata.get("workspace_state") != request_workspace_state
    ):
        patch["workspace_state"] = request_workspace_state

    request_origin = request_metadata.get("origin")
    if request_origin and current_metadata.get("origin") != request_origin:
        patch["origin"] = request_origin

    return patch


def resolve_thread_runtime_state(
    *,
    thread: ThreadMetadata,
    context: ReportAgentContext,
) -> ResolvedThreadRuntimeState:
    current_metadata = parse_chat_metadata(thread.metadata)
    request_metadata = parse_chat_metadata(context.request_metadata)
    runtime_patch = build_runtime_metadata_patch(
        current_metadata=current_metadata,
        request_metadata=request_metadata,
    )
    metadata = (
        merge_chat_metadata(current_metadata, runtime_patch)
        if runtime_patch
        else current_metadata
    )

    context.report_id = thread.id
    context.thread_metadata = metadata
    context.thread_title = thread.title
    context.chart_cache = dict(metadata.get("chart_cache") or {})
    workspace_state = metadata.get("workspace_state")
    context.workspace_id = (
        workspace_state.get("workspace_id")
        if workspace_state is not None
        else None
    )
    context.workspace_name = (
        workspace_state.get("workspace_name")
        if workspace_state is not None
        else None
    )
    context.available_artifacts = [
        item
        for item in (workspace_state.get("items", []) if workspace_state is not None else [])
        if item.get("origin") == "created"
    ]
    context.available_files = workspace_files_from_workspace_state(
        workspace_state
    )
    context.agent_bundle = metadata.get("agent_bundle")
    query_plan_model, _ = build_query_plan_model(context.available_datasets)
    context.query_plan_model = query_plan_model

    thread.metadata = dict(metadata)

    return ResolvedThreadRuntimeState(
        metadata=metadata,
        available_files=list(context.available_files),
        query_plan_model=query_plan_model,
    )
