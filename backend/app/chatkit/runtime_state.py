from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.workspace_file import (
    CsvWorkspaceMetadata,
    JsonWorkspaceMetadata,
    PdfWorkspaceMetadata,
    WorkspaceFileMetadata,
)
from backend.app.chatkit.metadata import (
    AppThreadMetadata,
    ThreadMetadataPatch,
    WorkspaceState,
    WorkspaceStateFileSummary,
    merge_thread_metadata,
    parse_thread_metadata,
)
from chatkit.types import ThreadMetadata


@dataclass(kw_only=True)
class ResolvedThreadRuntimeState:
    metadata: AppThreadMetadata
    available_files: list[WorkspaceFileMetadata]
    query_plan_model: type[BaseModel]


def _workspace_file_from_summary(
    file_summary: WorkspaceStateFileSummary,
) -> WorkspaceFileMetadata:
    kind = file_summary["kind"]
    return WorkspaceFileMetadata(
        id=file_summary["id"],
        name=file_summary["name"],
        kind=kind,
        extension=file_summary.get("extension", ""),
        mime_type=file_summary.get("mime_type"),
        byte_size=file_summary.get("byte_size"),
        csv=(
            CsvWorkspaceMetadata(
                row_count=file_summary.get("row_count", 0),
                columns=list(file_summary.get("columns", [])),
                numeric_columns=list(file_summary.get("numeric_columns", [])),
                sample_rows=list(file_summary.get("sample_rows", [])),
            )
            if kind == "csv"
            else None
        ),
        json=(
            JsonWorkspaceMetadata(
                row_count=file_summary.get("row_count", 0),
                columns=list(file_summary.get("columns", [])),
                numeric_columns=list(file_summary.get("numeric_columns", [])),
                sample_rows=list(file_summary.get("sample_rows", [])),
            )
            if kind == "json"
            else None
        ),
        pdf=(
            PdfWorkspaceMetadata(page_count=file_summary.get("page_count"))
            if kind == "pdf"
            else None
        ),
    )


def workspace_files_from_workspace_state(
    workspace_state: WorkspaceState | None,
) -> list[WorkspaceFileMetadata]:
    if workspace_state is None:
        return []
    return [
        _workspace_file_from_summary(file_summary)
        for file_summary in workspace_state.get("files", [])
    ]


def build_runtime_metadata_patch(
    *,
    current_metadata: AppThreadMetadata,
    request_metadata: AppThreadMetadata,
) -> ThreadMetadataPatch:
    patch: ThreadMetadataPatch = {}

    request_surface_key = request_metadata.get("surface_key")
    if (
        request_surface_key
        and current_metadata.get("surface_key") != request_surface_key
    ):
        patch["surface_key"] = request_surface_key

    request_bundle = request_metadata.get("tool_provider_bundle")
    if (
        request_bundle is not None
        and current_metadata.get("tool_provider_bundle") != request_bundle
    ):
        patch["tool_provider_bundle"] = request_bundle

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
    current_metadata = parse_thread_metadata(thread.metadata)
    request_metadata = parse_thread_metadata(context.request_metadata)
    runtime_patch = build_runtime_metadata_patch(
        current_metadata=current_metadata,
        request_metadata=request_metadata,
    )
    metadata = (
        merge_thread_metadata(current_metadata, runtime_patch)
        if runtime_patch
        else current_metadata
    )

    context.report_id = thread.id
    context.thread_metadata = metadata
    context.chart_cache = dict(metadata.get("chart_cache") or {})
    context.available_files = workspace_files_from_workspace_state(
        metadata.get("workspace_state")
    )
    context.tool_provider_bundle = metadata.get("tool_provider_bundle")
    query_plan_model, _ = build_query_plan_model(context.available_datasets)
    context.query_plan_model = query_plan_model

    thread.metadata = dict(metadata)

    return ResolvedThreadRuntimeState(
        metadata=metadata,
        available_files=list(context.available_files),
        query_plan_model=query_plan_model,
    )
