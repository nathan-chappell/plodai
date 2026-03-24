from datetime import datetime

from chatkit.types import ThreadMetadata

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.runtime_state import resolve_thread_runtime_state


def test_resolve_thread_runtime_state_hydrates_context_from_workspace_state() -> None:
    context = ReportAgentContext(
        report_id="pending_thread",
        user_id="user_123",
        user_email=None,
        db=None,
        request_metadata={
            "agent_bundle": {
                "root_agent_id": "analysis-agent",
                "agents": [
                    {
                        "agent_id": "analysis-agent",
                        "agent_name": "Analysis",
                        "instructions": "Inspect datasets.",
                        "client_tools": [],
                        "delegation_targets": [],
                    }
                ],
            },
            "workspace_state": {
                "version": "v4",
                "workspace_id": "workspace-tour",
                "workspace_name": "Tour Workspace",
                "app_id": "plodai",
                "selected_item_id": "file_csv",
                "items": [
                    {
                        "origin": "upload",
                        "id": "file_csv",
                        "workspace_id": "workspace-tour",
                        "name": "sales.csv",
                        "kind": "csv",
                        "extension": "csv",
                        "content_key": "sha256:file_csv",
                        "local_status": "available",
                        "preview": {
                            "row_count": 2,
                            "columns": ["region", "revenue"],
                            "numeric_columns": ["revenue"],
                            "sample_rows": [{"region": "West", "revenue": 10}],
                        },
                        "created_at": "2026-03-20T09:00:00Z",
                        "updated_at": "2026-03-20T09:00:00Z",
                    },
                    {
                        "origin": "upload",
                        "id": "file_image",
                        "workspace_id": "workspace-tour",
                        "name": "walnut.png",
                        "kind": "image",
                        "extension": "png",
                        "mime_type": "image/png",
                        "byte_size": 1024,
                        "content_key": "sha256:file_image",
                        "local_status": "available",
                        "preview": {
                            "width": 1200,
                            "height": 800,
                        },
                        "created_at": "2026-03-20T09:05:00Z",
                        "updated_at": "2026-03-20T09:05:00Z",
                    },
                    {
                        "origin": "created",
                        "id": "report-1",
                        "workspace_id": "workspace-tour",
                        "kind": "report.v1",
                        "schema_version": "v1",
                        "title": "Tour report",
                        "current_revision": 1,
                        "created_by_user_id": "user_123",
                        "summary": {"slide_count": 1},
                        "latest_op": "item.create",
                        "created_at": "2026-03-20T09:10:00Z",
                        "updated_at": "2026-03-20T09:10:00Z",
                    },
                ],
            },
        },
    )
    thread = ThreadMetadata(
        id="thread_123",
        created_at=datetime.now(),
        metadata={},
    )

    runtime_state = resolve_thread_runtime_state(thread=thread, context=context)

    assert runtime_state.metadata["workspace_state"]["workspace_id"] == "workspace-tour"
    assert runtime_state.metadata["workspace_state"]["workspace_name"] == "Tour Workspace"
    assert runtime_state.metadata["workspace_state"]["app_id"] == "plodai"
    assert context.report_id == "thread_123"
    assert context.workspace_id == "workspace-tour"
    assert context.workspace_name == "Tour Workspace"
    assert context.agent_id == "analysis-agent"
    assert context.dataset_ids == ["file_csv"]
    assert context.available_artifacts[0]["id"] == "report-1"
    assert context.available_files[0].csv is not None
    assert context.available_files[1].image is not None
    assert context.available_files[1].image.width == 1200
    assert context.available_files[1].image.height == 800
