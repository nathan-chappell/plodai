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
                        "agent_name": "Analysis Agent",
                        "instructions": "Inspect datasets.",
                        "client_tools": [],
                        "delegation_targets": [],
                    }
                ],
            },
            "workspace_state": {
                "version": "v1",
                "context": {
                    "workspace_id": "workspace-demo",
                    "referenced_item_ids": ["file_csv"],
                },
                "files": [
                    {
                        "id": "file_csv",
                        "name": "sales.csv",
                        "bucket": "uploaded",
                        "producer_key": "analysis-agent",
                        "producer_label": "Analysis Agent",
                        "source": "uploaded",
                        "kind": "csv",
                        "extension": "csv",
                        "row_count": 2,
                        "columns": ["region", "revenue"],
                        "numeric_columns": ["revenue"],
                        "sample_rows": [{"region": "West", "revenue": 10}],
                    },
                    {
                        "id": "file_image",
                        "name": "walnut.png",
                        "bucket": "uploaded",
                        "producer_key": "uploaded",
                        "producer_label": "Uploaded",
                        "source": "uploaded",
                        "kind": "image",
                        "extension": "png",
                        "mime_type": "image/png",
                        "byte_size": 1024,
                        "width": 1200,
                        "height": 800,
                    },
                ],
                "reports": [],
            },
        },
    )
    thread = ThreadMetadata(
        id="thread_123",
        created_at=datetime.now(),
        metadata={},
    )

    runtime_state = resolve_thread_runtime_state(thread=thread, context=context)

    assert runtime_state.metadata["workspace_state"]["context"]["workspace_id"] == "workspace-demo"
    assert context.report_id == "thread_123"
    assert context.agent_id == "analysis-agent"
    assert context.dataset_ids == ["file_csv"]
    assert context.available_files[0].csv is not None
    assert context.available_files[1].image is not None
    assert context.available_files[1].image.width == 1200
    assert context.available_files[1].image.height == 800
