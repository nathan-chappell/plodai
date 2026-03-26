import pytest

from backend.app.chatkit.metadata import merge_chat_metadata, parse_chat_metadata


def test_parse_chat_metadata_accepts_canonical_fields_only() -> None:
    metadata = parse_chat_metadata(
        {
            "title": " Walnut scouting ",
            "origin": "interactive",
        }
    )

    assert metadata == {
        "title": "Walnut scouting",
        "origin": "interactive",
    }


def test_parse_chat_metadata_rejects_legacy_or_invalid_fields() -> None:
    with pytest.raises(ValueError):
        parse_chat_metadata({"workspace_state": {"workspace_id": "legacy"}})

    with pytest.raises(ValueError):
        parse_chat_metadata({"usage": {"input_tokens": "bad"}})


def test_merge_chat_metadata_removes_null_fields() -> None:
    merged = merge_chat_metadata(
        {
            "title": "Current title",
            "origin": "interactive",
        },
        {
            "title": None,
        },
    )

    assert merged == {
        "origin": "interactive",
    }
