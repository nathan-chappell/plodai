from backend.app.chatkit.metadata import (
    merge_thread_metadata,
    normalize_thread_metadata,
)


def test_normalize_thread_metadata_filters_expected_fields() -> None:
    metadata = normalize_thread_metadata(
        {
            "title": "Quarterly review",
            "investigation_brief": "  Validate whether the west region is actually underperforming.  ",
            "chart_cache": {"chart-1": "data:image/png;base64,abc", 2: "bad"},
            "openai_conversation_id": "conv_123",
            "openai_previous_response_id": "resp_456",
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "estimated_cost_usd": 0.001234567,
                "ignored": True,
            },
            "ignored": True,
        }
    )

    assert metadata == {
        "title": "Quarterly review",
        "investigation_brief": "Validate whether the west region is actually underperforming.",
        "chart_cache": {"chart-1": "data:image/png;base64,abc"},
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_456",
        "usage": {
            "input_tokens": 120,
            "output_tokens": 30,
            "estimated_cost_usd": 0.00123457,
        },
    }


def test_merge_thread_metadata_allows_patch_and_removal() -> None:
    merged = merge_thread_metadata(
        {
            "title": "Initial",
            "investigation_brief": "Look for margin pressure.",
            "openai_conversation_id": "conv_123",
        },
        {
            "title": "Updated",
            "investigation_brief": "Compare east and west performance.",
            "openai_previous_response_id": "resp_789",
        },
    )

    assert merged == {
        "title": "Updated",
        "investigation_brief": "Compare east and west performance.",
        "openai_conversation_id": "conv_123",
        "openai_previous_response_id": "resp_789",
    }
