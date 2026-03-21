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
    AppThreadMetadata,
    ShellState,
    ShellStateResourceSummary,
    ThreadMetadataPatch,
    merge_thread_metadata,
    parse_thread_metadata,
)
from chatkit.types import ThreadMetadata


@dataclass(kw_only=True)
class ResolvedThreadRuntimeState:
    metadata: AppThreadMetadata
    available_files: list[WorkspaceFileMetadata]
    query_plan_model: type[BaseModel]

def _workspace_file_from_shell_resource(
    resource_summary: ShellStateResourceSummary,
) -> WorkspaceFileMetadata | None:
    resource_kind = resource_summary["kind"]
    if resource_kind == "report":
        return None

    extension = (resource_summary.get("extension") or "").lower()
    mime_type = resource_summary.get("mime_type")
    if resource_kind == "dataset":
        kind = "json" if extension == "json" else "csv"
    elif resource_kind == "document":
        kind = "pdf" if extension == "pdf" or mime_type == "application/pdf" else "other"
    elif resource_kind == "image":
        kind = "image"
    else:
        kind = "other"

    return WorkspaceFileMetadata(
        id=resource_summary["id"],
        name=resource_summary["title"],
        kind=kind,
        extension=resource_summary.get("extension") or "",
        mime_type=mime_type,
        byte_size=resource_summary.get("byte_size"),
        csv=(
            CsvWorkspaceMetadata(
                row_count=resource_summary.get("row_count") or 0,
                columns=list(resource_summary.get("columns", [])),
                numeric_columns=list(resource_summary.get("numeric_columns", [])),
                sample_rows=list(resource_summary.get("sample_rows", [])),
            )
            if kind == "csv"
            else None
        ),
        json=(
            JsonWorkspaceMetadata(
                row_count=resource_summary.get("row_count") or 0,
                columns=list(resource_summary.get("columns", [])),
                numeric_columns=list(resource_summary.get("numeric_columns", [])),
                sample_rows=list(resource_summary.get("sample_rows", [])),
            )
            if kind == "json"
            else None
        ),
        pdf=(
            PdfWorkspaceMetadata(page_count=resource_summary.get("page_count"))
            if kind == "pdf"
            else None
        ),
        image=(
            ImageWorkspaceMetadata(
                width=resource_summary.get("width"),
                height=resource_summary.get("height"),
            )
            if kind == "image"
            else None
        ),
    )


def workspace_files_from_shell_state(
    shell_state: ShellState | None,
) -> list[WorkspaceFileMetadata]:
    if shell_state is None:
        return []
    files: list[WorkspaceFileMetadata] = []
    for resource_summary in shell_state.get("resources", []):
        file_metadata = _workspace_file_from_shell_resource(resource_summary)
        if file_metadata is not None:
            files.append(file_metadata)
    return files


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

    request_bundle = request_metadata.get("agent_bundle")
    if (
        request_bundle is not None
        and current_metadata.get("agent_bundle") != request_bundle
    ):
        patch["agent_bundle"] = request_bundle

    request_shell_state = request_metadata.get("shell_state")
    if (
        request_shell_state is not None
        and current_metadata.get("shell_state") != request_shell_state
    ):
        patch["shell_state"] = request_shell_state

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
    context.available_files = workspace_files_from_shell_state(
        metadata.get("shell_state")
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
