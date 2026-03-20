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
            "surface_key": "/capabilities/report-agent",
            "workspace_state": {
                "version": "v1",
                "context": {
                    "path_prefix": "/report-agent/",
                    "referenced_item_ids": ["file-1"],
                },
                "files": [
                    {
                        "id": "file-1",
                        "name": "sales.csv",
                        "path": "/report-agent/sales.csv",
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
            "execution_mode": "batch",
            "origin": "ui_integration_test",
            "demo_validator_cost_snapshot": {
                "thread_id": "thr_validator",
                "scope": "before_current_turn",
                "usage": {
                    "input_tokens": 120,
                    "output_tokens": 30,
                    "cost_usd": 0.001234567,
                    "ignored": True,
                },
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
        "surface_key": "/capabilities/report-agent",
        "workspace_state": {
            "version": "v1",
            "context": {
                "path_prefix": "/report-agent/",
                "referenced_item_ids": ["file-1"],
            },
            "files": [
                {
                    "id": "file-1",
                    "name": "sales.csv",
                    "path": "/report-agent/sales.csv",
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
        "execution_mode": "batch",
        "origin": "ui_integration_test",
        "demo_validator_cost_snapshot": {
            "thread_id": "thr_validator",
            "scope": "before_current_turn",
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "cost_usd": 0.00123457,
            },
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
            "surface_key": "/capabilities/csv-agent",
            "openai_conversation_id": "conv_123",
            "execution_mode": "interactive",
            "origin": "interactive",
        },
        {
            "title": "Updated",
            "investigation_brief": "Compare east and west performance.",
            "surface_key": "/capabilities/report-agent",
            "workspace_state": {
                "version": "v1",
                "context": {
                    "path_prefix": "/report-agent/charts/",
                    "referenced_item_ids": ["chart-1"],
                },
                "files": [
                    {
                        "id": "chart-1",
                        "name": "revenue.json",
                        "path": "/artifacts/data/revenue.json",
                        "kind": "json",
                        "extension": "json",
                    }
                ],
                "reports": [],
                "agents_markdown": "# AGENTS.md\n\nPrefer compact artifact names.",
            },
            "openai_previous_response_id": "resp_789",
            "execution_mode": "batch",
            "origin": "ui_integration_test",
        },
    )

    assert merged == {
        "title": "Updated",
        "investigation_brief": "Compare east and west performance.",
        "surface_key": "/capabilities/report-agent",
        "workspace_state": {
            "version": "v1",
            "context": {
                "path_prefix": "/report-agent/charts/",
                "referenced_item_ids": ["chart-1"],
            },
            "files": [
                {
                    "id": "chart-1",
                    "name": "revenue.json",
                    "path": "/artifacts/data/revenue.json",
                    "kind": "json",
                    "extension": "json",
                }
            ],
            "reports": [],
            "agents_markdown": "# AGENTS.md\n\nPrefer compact artifact names.",
        },
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_789",
        "execution_mode": "batch",
        "origin": "ui_integration_test",
    }
