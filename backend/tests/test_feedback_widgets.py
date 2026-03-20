from backend.app.agents.widgets import (
    build_feedback_session_copy_text,
    build_feedback_session_widget,
)
from backend.app.chatkit.metadata import PendingFeedbackSession


def test_build_feedback_session_widget_has_submit_and_cancel_actions() -> None:
    session: PendingFeedbackSession = {
        "session_id": "fbs_123",
        "item_ids": ["msg_123"],
        "recommended_options": [
            "The chart never appeared.",
            "The explanation stopped too early.",
            "The output was helpful and clear.",
        ],
        "message_draft": None,
        "inferred_sentiment": "negative",
        "mode": "recommendations",
    }
    widget = build_feedback_session_widget(session)

    assert widget["type"] == "Card"
    assert widget["asForm"] is True
    assert widget["padding"] == "8px"
    assert widget["confirm"]["action"]["type"] == "submit_feedback_session"
    assert widget["cancel"]["action"]["type"] == "cancel_feedback_session"
    child_values = str(widget["children"])
    assert "Pick one of the suggested notes" not in child_values
    assert "Suggestions" in child_values
    assert "Message" in child_values
    assert build_feedback_session_copy_text(session) == "Feedback form for msg_123."


def test_build_feedback_session_widget_omits_suggestions_in_confirmation_mode() -> None:
    session: PendingFeedbackSession = {
        "session_id": "fbs_456",
        "item_ids": ["msg_456"],
        "recommended_options": [
            "The flow was smooth.",
            "The chart looked wrong.",
            "The explanation was too short.",
        ],
        "message_draft": "The chart never appeared.",
        "inferred_sentiment": "negative",
        "mode": "confirmation",
    }

    widget = build_feedback_session_widget(session)
    child_values = str(widget["children"])

    assert "Suggestions" not in child_values
    assert "Message" in child_values
    assert "Review the parsed note" not in child_values
