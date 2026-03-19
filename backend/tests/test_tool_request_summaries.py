from backend.app.agents.tools import _summarize_client_tool_request


def test_workspace_inventory_summary_folds_include_samples_into_caption() -> None:
    summary, details = _summarize_client_tool_request(
        "list_csv_files",
        {"includeSamples": True},
    )

    assert summary == "Queued a CSV workspace listing with samples."
    assert details == []


def test_workspace_inventory_summary_omits_default_option_details() -> None:
    summary, details = _summarize_client_tool_request(
        "list_csv_files",
        {"includeSamples": False},
    )

    assert summary == "Queued a CSV workspace listing."
    assert details == []
