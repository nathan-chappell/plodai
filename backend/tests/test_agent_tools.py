from backend.app.agents.widgets import (
    build_handoff_trace_copy_text,
    build_handoff_trace_widget,
    build_tool_trace_copy_text,
    build_plan_widget,
    build_tool_trace_widget,
    build_workspace_context_copy_text,
    build_workspace_context_widget,
)


def collect_text_values(children: list[dict[str, object]]) -> list[str]:
    values: list[str] = []
    for child in children:
        value = child.get("value")
        if isinstance(value, str):
            values.append(value)
        nested_children = child.get("children")
        if isinstance(nested_children, list):
            values.extend(
                collect_text_values(
                    [nested for nested in nested_children if isinstance(nested, dict)]
                )
            )
    return values


def test_build_plan_widget_includes_plan_sections() -> None:
    widget = build_plan_widget(
        {
            "id": "plan_123",
            "focus": "Investigate west region revenue drop",
            "planned_steps": [
                "List attached files",
                "Run grouped revenue totals by region and month",
            ],
            "success_criteria": ["Explain the strongest driver of the drop"],
            "follow_on_tool_hints": ["run_aggregate_query", "render_chart_from_dataset"],
        }
    )

    assert widget["type"] == "Card"
    assert widget["status"] == {"text": "Plan captured", "icon": "check-circle"}
    assert widget["children"][0]["type"] == "Col"
    text_values = collect_text_values(widget["children"])
    assert "Investigate west region revenue drop" in text_values
    assert "1. List attached files" in text_values
    assert "2. Run grouped revenue totals by region and month" in text_values
    assert "Success criteria" in text_values
    assert "- Explain the strongest driver of the drop" in text_values
    assert "Suggested next tools" in text_values
    assert "run_aggregate_query, render_chart_from_dataset" in text_values


def test_build_tool_trace_widget_shows_compact_details_and_copy_text() -> None:
    widget = build_tool_trace_widget(
        "run_aggregate_query",
        "Run Aggregate Query(dataset=revenue_csv)",
        ["Dataset: revenue_csv", "Filters: 1", "Group by: 2", "Aggregates: 3"],
    )
    copy_text = build_tool_trace_copy_text(
        "run_aggregate_query",
        "Run Aggregate Query(dataset=revenue_csv)",
        ["Dataset: revenue_csv", "Filters: 1", "Group by: 2", "Aggregates: 3"],
    )

    assert widget["type"] == "Card"
    assert "status" not in widget
    assert widget["children"][0]["type"] == "Col"
    text_values = collect_text_values(widget["children"])
    assert text_values == ["Run Aggregate Query(dataset=revenue_csv)"]
    assert copy_text == "Run Aggregate Query(dataset=revenue_csv)"


def test_build_tool_trace_widget_uses_explicit_title_when_provided() -> None:
    widget = build_tool_trace_widget(
        "create_dataset",
        "Derived dataset artifact",
        ["File: aggregated_sales_by_month_category.csv", "Format: csv"],
        title="Create Dataset(aggregated_sales_by_month_category.csv)",
    )
    copy_text = build_tool_trace_copy_text(
        "create_dataset",
        "Derived dataset artifact",
        ["File: aggregated_sales_by_month_category.csv", "Format: csv"],
        title="Create Dataset(aggregated_sales_by_month_category.csv)",
    )

    text_values = collect_text_values(widget["children"])
    assert "Create Dataset(aggregated_sales_by_month_category.csv)" in text_values
    assert copy_text == "Create Dataset(aggregated_sales_by_month_category.csv)"


def test_build_handoff_trace_widget_and_copy_text_include_agents() -> None:
    widget = build_handoff_trace_widget(
        source_agent_name="Report Agent",
        target_agent_name="Chart Agent",
        handoff_tool_name="delegate_to_chart_agent",
        summary="Delegate chart work.",
    )
    copy_text = build_handoff_trace_copy_text(
        source_agent_name="Report Agent",
        target_agent_name="Chart Agent",
        handoff_tool_name="delegate_to_chart_agent",
        summary="Delegate chart work.",
    )

    assert widget["type"] == "Card"
    assert "status" not in widget
    text_values = collect_text_values(widget["children"])
    assert "Report Agent -> Chart Agent" in text_values
    assert "Delegate chart work." not in text_values
    assert "Tool: delegate_to_chart_agent" not in text_values
    assert copy_text == "Report Agent -> Chart Agent"


def test_build_workspace_context_widget_and_copy_text_include_paths() -> None:
    widget = build_workspace_context_widget(
        action_label="Changed prefix",
        path_prefix="/report-agent/reports/",
        target_path="/report-agent/reports/q1/",
    )
    copy_text = build_workspace_context_copy_text(
        action_label="Changed prefix",
        path_prefix="/report-agent/reports/",
        target_path="/report-agent/reports/q1/",
    )

    assert widget["type"] == "Card"
    assert widget["status"] == {"text": "Workspace updated", "icon": "cube"}
    assert widget["children"][0]["type"] == "Col"
    text_values = collect_text_values(widget["children"])
    assert "Changed prefix" in text_values
    assert "Active prefix: /report-agent/reports/" in text_values
    assert "Target: /report-agent/reports/q1/" in text_values
    assert copy_text == (
        "Changed prefix\n"
        "Active prefix: /report-agent/reports/\n"
        "Target: /report-agent/reports/q1/"
    )
