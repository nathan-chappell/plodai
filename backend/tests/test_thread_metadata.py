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
            "shell_state": {
                "version": "v1",
                "context_id": "workspace-default",
                "context_name": "Workspace",
                "active_agent_id": "analysis-agent",
                "agents": [
                    {
                        "agent_id": "analysis-agent",
                        "goal": "Investigate west region performance.",
                        "resource_count": 1,
                        "current_report_id": "report-1",
                        "ignored": True,
                    }
                ],
                "resources": [
                    {
                        "id": "file-1",
                        "owner_agent_id": "analysis-agent",
                        "kind": "dataset",
                        "title": "sales.csv",
                        "created_at": "2026-03-19T10:00:00Z",
                        "summary": "Uploaded sales export",
                        "payload_ref": "file:file-1",
                        "extension": "csv",
                        "row_count": 12,
                        "columns": ["region"],
                        "numeric_columns": [],
                        "sample_rows": [{"region": "West"}],
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
        "shell_state": {
            "version": "v1",
            "context_id": "workspace-default",
            "context_name": "Workspace",
            "active_agent_id": "analysis-agent",
            "agents": [
                {
                    "agent_id": "analysis-agent",
                    "goal": "Investigate west region performance.",
                    "resource_count": 1,
                    "current_report_id": "report-1",
                }
            ],
            "resources": [
                {
                    "id": "file-1",
                    "owner_agent_id": "analysis-agent",
                    "kind": "dataset",
                    "title": "sales.csv",
                    "created_at": "2026-03-19T10:00:00Z",
                    "summary": "Uploaded sales export",
                    "payload_ref": "file:file-1",
                    "extension": "csv",
                    "row_count": 12,
                    "columns": ["region"],
                    "sample_rows": [{"region": "West"}],
                }
            ],
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
            "shell_state": {
                "version": "v1",
                "context_id": "workspace-default",
                "context_name": "Workspace",
                "active_agent_id": "analysis-agent",
                "agents": [
                    {
                        "agent_id": "analysis-agent",
                        "goal": "Compare east and west performance.",
                        "resource_count": 1,
                    }
                ],
                "resources": [
                    {
                        "id": "chart-1",
                        "owner_agent_id": "analysis-agent",
                        "kind": "dataset",
                        "title": "revenue.json",
                        "created_at": "2026-03-19T12:00:00Z",
                        "summary": "Derived revenue export",
                        "payload_ref": "file:chart-1",
                        "extension": "json",
                        "mime_type": "application/json",
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

    assert merged == {
        "title": "Updated",
        "investigation_brief": "Compare east and west performance.",
        "surface_key": "/workspace",
        "shell_state": {
            "version": "v1",
            "context_id": "workspace-default",
            "context_name": "Workspace",
            "active_agent_id": "analysis-agent",
            "agents": [
                {
                    "agent_id": "analysis-agent",
                    "goal": "Compare east and west performance.",
                    "resource_count": 1,
                }
            ],
            "resources": [
                {
                    "id": "chart-1",
                    "owner_agent_id": "analysis-agent",
                    "kind": "dataset",
                    "title": "revenue.json",
                    "created_at": "2026-03-19T12:00:00Z",
                    "summary": "Derived revenue export",
                    "payload_ref": "file:chart-1",
                    "extension": "json",
                    "mime_type": "application/json",
                }
            ],
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


def test_parse_thread_metadata_keeps_tour_picker_tool_display_metadata() -> None:
    metadata = parse_thread_metadata(
        {
            "agent_bundle": {
                "root_agent_id": "default-agent",
                "agents": [
                    {
                        "agent_id": "default-agent",
                        "agent_name": "Default",
                        "instructions": "Route work.",
                        "client_tools": [
                            {
                                "type": "function",
                                "name": "list_tour_scenarios",
                                "description": "Open the tour picker.",
                                "parameters": {
                                    "type": "object",
                                    "properties": {},
                                    "additionalProperties": False,
                                },
                                "strict": True,
                                "display": {
                                    "label": "Open tour picker",
                                    "tour_picker": {
                                        "title": "Choose a guided tour",
                                        "summary": "Pick the best guided sample.",
                                        "scenarios": [
                                            {
                                                "scenario_id": "report-tour",
                                                "title": "Report tour",
                                                "summary": "Create one chart-backed report slide.",
                                                "workspace_name": "Report tour",
                                                "target_agent_id": "report-agent",
                                                "default_asset_count": 2,
                                                "ignored": True,
                                            }
                                        ],
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
        "label": "Open tour picker",
        "tour_picker": {
            "title": "Choose a guided tour",
            "summary": "Pick the best guided sample.",
            "scenarios": [
                {
                    "scenario_id": "report-tour",
                    "title": "Report tour",
                    "summary": "Create one chart-backed report slide.",
                    "workspace_name": "Report tour",
                    "target_agent_id": "report-agent",
                    "default_asset_count": 2,
                }
            ],
        },
    }
