from backend.app.agents.tools import _build_plan_widget, _build_tool_trace_widget


def test_build_plan_widget_includes_plan_sections() -> None:
    widget = _build_plan_widget(
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
    widget = _build_tool_trace_widget(
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
