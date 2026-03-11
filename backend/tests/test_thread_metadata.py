from app.chatkit.metadata import merge_thread_metadata, normalize_thread_metadata


def test_normalize_thread_metadata_filters_expected_fields() -> None:
    metadata = normalize_thread_metadata(
        {
            "title": "Quarterly review",
            "dataset_ids": ["sales_csv", 42],
            "datasets": [{"id": "sales_csv", "columns": ["region"]}, "skip-me"],
            "chart_cache": {"chart-1": "data:image/png;base64,abc", 2: "bad"},
            "openai_conversation_id": "conv_123",
            "openai_previous_response_id": "resp_456",
            "ignored": True,
        }
    )

    assert metadata == {
        "title": "Quarterly review",
        "dataset_ids": ["sales_csv", "42"],
        "datasets": [{"id": "sales_csv", "columns": ["region"]}],
        "chart_cache": {"chart-1": "data:image/png;base64,abc"},
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_456",
    }


def test_merge_thread_metadata_allows_patch_and_removal() -> None:
    merged = merge_thread_metadata(
        {
            "title": "Initial",
            "dataset_ids": ["sales_csv"],
            "openai_conversation_id": "conv_123",
        },
        {
            "title": "Updated",
            "openai_previous_response_id": "resp_789",
            # "openai_conversation_id": None,
        },
    )

    assert merged == {
        "title": "Updated",
        "dataset_ids": ["sales_csv"],
        "openai_previous_response_id": "resp_789",
    }
