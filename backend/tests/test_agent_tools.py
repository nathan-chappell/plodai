from backend.app.agents.widgets import (
    build_plan_widget,
    build_tool_trace_widget,
    build_workspace_context_copy_text,
    build_workspace_context_widget,
)


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
            "follow_on_tool_hints": ["run_aggregate_query", "render_chart_from_file"],
        }
    )

    assert widget["type"] == "Card"
    assert widget["status"] == {"text": "Plan captured", "icon": "check-circle"}
    text_values = [
        child.get("value")
        for child in widget["children"]
        if isinstance(child, dict) and "value" in child
    ]
    assert "Investigate west region revenue drop" in text_values
    assert "1. List attached files" in text_values
    assert "2. Run grouped revenue totals by region and month" in text_values
    assert "Success criteria" in text_values
    assert "- Explain the strongest driver of the drop" in text_values
    assert "Suggested next tools" in text_values
    assert "run_aggregate_query, render_chart_from_file" in text_values


def test_build_tool_trace_widget_includes_summary_and_details() -> None:
    widget = build_tool_trace_widget(
        "run_aggregate_query",
        "Validated a grouped aggregate query plan.",
        ["Dataset: revenue_csv", "Group by: 2", "Aggregates: 3"],
    )

    assert widget["type"] == "Card"
    assert widget["status"] == {"text": "Tool requested", "icon": "bolt"}
    text_values = [
        child.get("value")
        for child in widget["children"]
        if isinstance(child, dict) and "value" in child
    ]
    assert "Run Aggregate Query" in text_values
    assert "Validated a grouped aggregate query plan." in text_values
    assert "Dataset: revenue_csv" in text_values
    assert "Group by: 2" in text_values
    assert "Aggregates: 3" in text_values


def test_build_workspace_context_widget_and_copy_text_include_paths() -> None:
    widget = build_workspace_context_widget(
        action_label="Created directory",
        cwd_path="/report-agent/reports",
        target_path="/report-agent/reports/q1",
    )
    copy_text = build_workspace_context_copy_text(
        action_label="Created directory",
        cwd_path="/report-agent/reports",
        target_path="/report-agent/reports/q1",
    )

    assert widget["type"] == "Card"
    assert widget["status"] == {"text": "Workspace updated", "icon": "cube"}
    text_values = [
        child.get("value")
        for child in widget["children"]
        if isinstance(child, dict) and "value" in child
    ]
    assert "Created directory" in text_values
    assert "Current directory: /report-agent/reports" in text_values
    assert "Target: /report-agent/reports/q1" in text_values
    assert copy_text == (
        "Created directory\n"
        "Current directory: /report-agent/reports\n"
        "Target: /report-agent/reports/q1"
    )
