from backend.app.chatkit.metadata import (
    merge_thread_metadata,
    parse_thread_metadata,
)


def test_parse_thread_metadata_filters_expected_fields() -> None:
    metadata = parse_thread_metadata(
        {
            "title": "Quarterly review",
            "investigation_brief": "  Validate whether the west region is actually underperforming.  ",
            "plan": {
                "id": "plan_123",
                "focus": "Validate west region performance",
                "planned_steps": ["List files", "Run grouped aggregates"],
                "success_criteria": ["Explain the strongest variance"],
                "follow_on_tool_hints": ["run_aggregate_query"],
            },
            "chart_cache": {"chart-1": "data:image/png;base64,abc", 2: "bad"},
            "surface_key": "/workspace",
            "workspace_state": {
                "version": "v1",
                "context": {
                    "workspace_id": "workspace-default",
                    "referenced_item_ids": ["file-1"],
                },
                "files": [
                    {
                        "id": "file-1",
                        "name": "sales.csv",
                        "bucket": "uploaded",
                        "producer_key": "uploaded",
                        "producer_label": "Uploaded",
                        "source": "uploaded",
                        "kind": "csv",
                        "extension": "csv",
                        "row_count": 12,
                        "columns": ["region"],
                        "numeric_columns": [],
                        "sample_rows": [{"region": "West"}],
                    }
                ],
                "reports": [
                    {
                        "report_id": "report-1",
                        "title": "Current report",
                        "item_count": 1,
                        "slide_count": 1,
                        "updated_at": "2026-03-19T10:00:00Z",
                    }
                ],
                "current_report_id": "report-1",
                "current_goal": "Investigate west region performance.",
                "agents_markdown": "# AGENTS.md\n\n## Current Objective\nInvestigate west region performance.\n",
            },
            "openai_conversation_id": "conv_123",
            "openai_previous_response_id": "resp_456",
            "origin": "ui_integration_test",
            "feedback_session": {
                "session_id": "fbs_123",
                "item_ids": ["msg_123"],
                "recommended_options": [
                    "The chart never appeared.",
                    "The explanation stopped too early.",
                    "The result was strong overall.",
                ],
                "message_draft": "The chart never appeared.",
                "inferred_sentiment": "negative",
                "mode": "confirmation",
                "ignored": True,
            },
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "cost_usd": 0.001234567,
                "ignored": True,
            },
            "ignored": True,
        }
    )

    assert metadata == {
        "title": "Quarterly review",
        "investigation_brief": "Validate whether the west region is actually underperforming.",
        "plan": {
            "id": "plan_123",
            "focus": "Validate west region performance",
            "planned_steps": ["List files", "Run grouped aggregates"],
            "success_criteria": ["Explain the strongest variance"],
            "follow_on_tool_hints": ["run_aggregate_query"],
        },
        "chart_cache": {"chart-1": "data:image/png;base64,abc"},
        "surface_key": "/workspace",
        "workspace_state": {
            "version": "v1",
            "context": {
                "workspace_id": "workspace-default",
                "referenced_item_ids": ["file-1"],
            },
            "files": [
                {
                    "id": "file-1",
                    "name": "sales.csv",
                    "bucket": "uploaded",
                    "producer_key": "uploaded",
                    "producer_label": "Uploaded",
                    "source": "uploaded",
                    "kind": "csv",
                    "extension": "csv",
                    "row_count": 12,
                    "columns": ["region"],
                    "sample_rows": [{"region": "West"}],
                }
            ],
            "reports": [
                {
                    "report_id": "report-1",
                    "title": "Current report",
                    "item_count": 1,
                    "slide_count": 1,
                    "updated_at": "2026-03-19T10:00:00Z",
                }
            ],
            "current_report_id": "report-1",
            "current_goal": "Investigate west region performance.",
            "agents_markdown": "# AGENTS.md\n\n## Current Objective\nInvestigate west region performance.",
        },
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_456",
        "origin": "ui_integration_test",
        "feedback_session": {
            "session_id": "fbs_123",
            "item_ids": ["msg_123"],
            "recommended_options": [
                "The chart never appeared.",
                "The explanation stopped too early.",
                "The result was strong overall.",
            ],
            "message_draft": "The chart never appeared.",
            "inferred_sentiment": "negative",
            "mode": "confirmation",
        },
        "usage": {
            "input_tokens": 120,
            "output_tokens": 30,
            "cost_usd": 0.00123457,
        },
    }


def test_merge_thread_metadata_allows_patch_and_removal() -> None:
    merged = merge_thread_metadata(
        {
            "title": "Initial",
            "investigation_brief": "Look for margin pressure.",
            "surface_key": "/workspace",
            "openai_conversation_id": "conv_123",
            "origin": "interactive",
        },
        {
            "title": "Updated",
            "investigation_brief": "Compare east and west performance.",
            "surface_key": "/workspace",
            "workspace_state": {
                "version": "v1",
                "context": {
                    "workspace_id": "workspace-default",
                    "referenced_item_ids": ["chart-1"],
                },
                "files": [
                    {
                        "id": "chart-1",
                        "name": "revenue.json",
                        "bucket": "data",
                        "producer_key": "analysis-agent",
                        "producer_label": "Analysis Agent",
                        "source": "derived",
                        "kind": "json",
                        "extension": "json",
                    }
                ],
                "reports": [],
                "agents_markdown": "# AGENTS.md\n\nPrefer compact artifact names.",
            },
            "openai_previous_response_id": "resp_789",
            "origin": "ui_integration_test",
            "feedback_session": {
                "session_id": "fbs_789",
                "item_ids": ["msg_789"],
                "recommended_options": [
                    "The tool was helpful.",
                    "The tool failed to finish.",
                    "The explanation needed more detail.",
                ],
                "message_draft": "The tool failed to finish.",
                "inferred_sentiment": "negative",
                "mode": "recommendations",
            },
        },
    )

    assert merged == {
        "title": "Updated",
        "investigation_brief": "Compare east and west performance.",
        "surface_key": "/workspace",
        "workspace_state": {
            "version": "v1",
            "context": {
                "workspace_id": "workspace-default",
                "referenced_item_ids": ["chart-1"],
            },
            "files": [
                {
                    "id": "chart-1",
                    "name": "revenue.json",
                    "bucket": "data",
                    "producer_key": "analysis-agent",
                    "producer_label": "Analysis Agent",
                    "source": "derived",
                    "kind": "json",
                    "extension": "json",
                }
            ],
            "reports": [],
            "agents_markdown": "# AGENTS.md\n\nPrefer compact artifact names.",
        },
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_789",
        "origin": "ui_integration_test",
        "feedback_session": {
            "session_id": "fbs_789",
            "item_ids": ["msg_789"],
            "recommended_options": [
                "The tool was helpful.",
                "The tool failed to finish.",
                "The explanation needed more detail.",
            ],
            "message_draft": "The tool failed to finish.",
            "inferred_sentiment": "negative",
            "mode": "recommendations",
        },
    }
