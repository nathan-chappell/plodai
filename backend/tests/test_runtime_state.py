from datetime import datetime

from chatkit.types import ThreadMetadata

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.runtime_state import resolve_thread_runtime_state


def test_resolve_thread_runtime_state_hydrates_context_from_shell_state() -> None:
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
            "shell_state": {
                "version": "v1",
                "context_id": "workspace-tour",
                "context_name": "Tour Workspace",
                "active_agent_id": "analysis-agent",
                "agents": [
                    {
                        "agent_id": "analysis-agent",
                        "goal": "Inspect datasets.",
                        "resource_count": 2,
                    }
                ],
                "resources": [
                    {
                        "id": "file_csv",
                        "owner_agent_id": "analysis-agent",
                        "kind": "dataset",
                        "title": "sales.csv",
                        "created_at": "2026-03-20T09:00:00Z",
                        "summary": "Uploaded sales data",
                        "payload_ref": "file:file_csv",
                        "extension": "csv",
                        "row_count": 2,
                        "columns": ["region", "revenue"],
                        "numeric_columns": ["revenue"],
                        "sample_rows": [{"region": "West", "revenue": 10}],
                    },
                    {
                        "id": "file_image",
                        "owner_agent_id": "analysis-agent",
                        "kind": "image",
                        "title": "walnut.png",
                        "created_at": "2026-03-20T09:05:00Z",
                        "summary": "Leaf photo",
                        "payload_ref": "file:file_image",
                        "extension": "png",
                        "mime_type": "image/png",
                        "byte_size": 1024,
                        "width": 1200,
                        "height": 800,
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

    assert runtime_state.metadata["shell_state"]["context_id"] == "workspace-tour"
    assert runtime_state.metadata["shell_state"]["context_name"] == "Tour Workspace"
    assert context.report_id == "thread_123"
    assert context.agent_id == "analysis-agent"
    assert context.dataset_ids == ["file_csv"]
    assert context.available_files[0].csv is not None
    assert context.available_files[1].image is not None
    assert context.available_files[1].image.width == 1200
    assert context.available_files[1].image.height == 800
