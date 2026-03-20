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
            "capability_bundle": {
                "root_capability_id": "csv-agent",
                "capabilities": [
                    {
                        "capability_id": "csv-agent",
                        "agent_name": "CSV Agent",
                        "instructions": "Inspect CSV files.",
                        "client_tools": [],
                        "handoff_targets": [],
                    }
                ],
            },
            "workspace_state": {
                "version": "v1",
                "context": {
                    "path_prefix": "/csv-agent/",
                    "referenced_item_ids": ["file_csv"],
                },
                "files": [
                    {
                        "id": "file_csv",
                        "name": "sales.csv",
                        "path": "/csv-agent/sales.csv",
                        "kind": "csv",
                        "extension": "csv",
                        "row_count": 2,
                        "columns": ["region", "revenue"],
                        "numeric_columns": ["revenue"],
                        "sample_rows": [{"region": "West", "revenue": 10}],
                    }
                ],
                "reports": [],
            },
            "execution_mode": "batch",
        },
    )
    thread = ThreadMetadata(
        id="thread_123",
        created_at=datetime.now(),
        metadata={},
    )

    runtime_state = resolve_thread_runtime_state(thread=thread, context=context)

    assert runtime_state.metadata["execution_mode"] == "batch"
    assert (
        runtime_state.metadata["workspace_state"]["context"]["path_prefix"]
        == "/csv-agent/"
    )
    assert context.report_id == "thread_123"
    assert context.capability_id == "csv-agent"
    assert context.dataset_ids == ["file_csv"]
    assert context.available_files[0].csv is not None
