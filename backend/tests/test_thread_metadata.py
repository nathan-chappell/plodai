from backend.app.chatkit.metadata import (
    merge_chat_metadata,
    parse_chat_metadata,
)


def test_parse_chat_metadata_filters_expected_fields() -> None:
    metadata = parse_chat_metadata(
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
            "surface_key": "/agriculture",
            "workspace_state": {
                "version": "v4",
                "workspace_id": "workspace-default",
                "workspace_name": "Workspace",
                "app_id": "agriculture",
                "selected_item_id": "file-1",
                "current_report_item_id": "report-1",
                "items": [
                    {
                        "origin": "upload",
                        "id": "file-1",
                        "workspace_id": "workspace-default",
                        "name": "sales.csv",
                        "kind": "csv",
                        "extension": "csv",
                        "content_key": "sha256:file-1",
                        "local_status": "available",
                        "preview": {
                            "row_count": 12,
                            "columns": ["region"],
                            "numeric_columns": [],
                            "sample_rows": [{"region": "West"}],
                        },
                        "created_at": "2026-03-19T10:00:00Z",
                        "updated_at": "2026-03-19T10:00:00Z",
                        "ignored": True,
                    },
                    {
                        "origin": "created",
                        "id": "report-1",
                        "workspace_id": "workspace-default",
                        "kind": "report.v1",
                        "schema_version": "v1",
                        "title": "Quarterly review",
                        "current_revision": 2,
                        "created_by_user_id": "user_123",
                        "summary": {
                            "slide_count": 3,
                        },
                        "latest_op": "report.append_slide",
                        "created_at": "2026-03-19T11:00:00Z",
                        "updated_at": "2026-03-19T11:05:00Z",
                        "ignored": True,
                    }
                ],
                "ignored": True,
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

    assert metadata["title"] == "Quarterly review"
    assert (
        metadata["investigation_brief"]
        == "Validate whether the west region is actually underperforming."
    )
    assert metadata["plan"] == {
        "id": "plan_123",
        "focus": "Validate west region performance",
        "planned_steps": ["List files", "Run grouped aggregates"],
        "success_criteria": ["Explain the strongest variance"],
        "follow_on_tool_hints": ["run_aggregate_query"],
    }
    assert metadata["chart_cache"] == {"chart-1": "data:image/png;base64,abc"}
    assert metadata["surface_key"] == "/agriculture"
    assert metadata["openai_conversation_id"] == "conv_123"
    assert metadata["openai_previous_response_id"] == "resp_456"
    assert metadata["origin"] == "ui_integration_test"
    assert metadata["feedback_session"] == {
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
    }
    assert metadata["usage"] == {
        "input_tokens": 120,
        "output_tokens": 30,
        "cost_usd": 0.00123457,
    }

    workspace_state = metadata["workspace_state"]
    assert workspace_state["version"] == "v4"
    assert workspace_state["workspace_id"] == "workspace-default"
    assert workspace_state["workspace_name"] == "Workspace"
    assert workspace_state["app_id"] == "agriculture"
    assert workspace_state["selected_item_id"] == "file-1"
    assert workspace_state["current_report_item_id"] == "report-1"

    upload_item, created_item = workspace_state["items"]
    assert upload_item["origin"] == "upload"
    assert upload_item["id"] == "file-1"
    assert upload_item["kind"] == "csv"
    assert upload_item["content_key"] == "sha256:file-1"
    assert upload_item["local_status"] == "available"
    assert upload_item["preview"] == {
        "row_count": 12,
        "columns": ["region"],
        "sample_rows": [{"region": "West"}],
    }

    assert created_item["origin"] == "created"
    assert created_item["id"] == "report-1"
    assert created_item["kind"] == "report.v1"
    assert created_item["schema_version"] == "v1"
    assert created_item["title"] == "Quarterly review"
    assert created_item["current_revision"] == 2
    assert created_item["created_by_user_id"] == "user_123"
    assert created_item["summary"] == {"slide_count": 3}
    assert created_item["latest_op"] == "report.append_slide"


def test_merge_chat_metadata_allows_patch_and_removal() -> None:
    merged = merge_chat_metadata(
        {
            "title": "Initial",
            "investigation_brief": "Look for margin pressure.",
            "surface_key": "/agriculture",
            "openai_conversation_id": "conv_123",
            "origin": "interactive",
        },
        {
            "title": "Updated",
            "investigation_brief": "Compare east and west performance.",
            "surface_key": "/agriculture",
            "workspace_state": {
                "version": "v4",
                "workspace_id": "workspace-default",
                "workspace_name": "Workspace",
                "app_id": "documents",
                "items": [
                    {
                        "origin": "upload",
                        "id": "chart-1",
                        "workspace_id": "workspace-default",
                        "name": "revenue.json",
                        "kind": "json",
                        "extension": "json",
                        "mime_type": "application/json",
                        "content_key": "sha256:chart-1",
                        "local_status": "missing",
                        "preview": {
                            "row_count": 0,
                            "columns": [],
                            "numeric_columns": [],
                            "sample_rows": [],
                        },
                        "created_at": "2026-03-19T12:00:00Z",
                        "updated_at": "2026-03-19T12:00:00Z",
                    }
                ],
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

    assert merged["title"] == "Updated"
    assert merged["investigation_brief"] == "Compare east and west performance."
    assert merged["surface_key"] == "/agriculture"
    assert merged["openai_conversation_id"] == "conv_123"
    assert merged["openai_previous_response_id"] == "resp_789"
    assert merged["origin"] == "ui_integration_test"
    assert merged["feedback_session"] == {
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
    }

    workspace_state = merged["workspace_state"]
    assert workspace_state["version"] == "v4"
    assert workspace_state["workspace_id"] == "workspace-default"
    assert workspace_state["workspace_name"] == "Workspace"
    assert workspace_state["app_id"] == "documents"
    assert workspace_state["items"] == [
        {
            "origin": "upload",
            "id": "chart-1",
            "workspace_id": "workspace-default",
            "name": "revenue.json",
            "kind": "json",
            "extension": "json",
            "mime_type": "application/json",
            "content_key": "sha256:chart-1",
            "local_status": "missing",
            "preview": {
                "row_count": 0,
                "columns": [],
                "numeric_columns": [],
                "sample_rows": [],
            },
            "created_at": "2026-03-19T12:00:00Z",
            "updated_at": "2026-03-19T12:00:00Z",
        }
    ]


def test_parse_chat_metadata_keeps_generic_tool_display_metadata() -> None:
    metadata = parse_chat_metadata(
        {
            "agent_bundle": {
                "root_agent_id": "agriculture-agent",
                "agents": [
                    {
                        "agent_id": "agriculture-agent",
                        "agent_name": "Agriculture",
                        "instructions": "Inspect plant images.",
                        "client_tools": [
                            {
                                "type": "function",
                                "name": "inspect_image_file",
                                "description": "Inspect an uploaded image.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "file_id": {"type": "string"},
                                        "max_dimension": {"type": "integer"},
                                    },
                                    "required": ["file_id"],
                                    "additionalProperties": False,
                                },
                                "strict": True,
                                "display": {
                                    "label": "Inspect image",
                                    "prominent_args": ["file_id", "max_dimension"],
                                    "arg_labels": {
                                        "file_id": "file",
                                        "max_dimension": "size",
                                    },
                                },
                            }
                        ],
                        "delegation_targets": [],
                    }
                ],
            }
        }
    )

    assert metadata["agent_bundle"]["agents"][0]["client_tools"][0]["display"] == {
        "label": "Inspect image",
        "prominent_args": ["file_id", "max_dimension"],
        "arg_labels": {
            "file_id": "file",
            "max_dimension": "size",
        },
    }
