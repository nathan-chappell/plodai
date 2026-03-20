from backend.app.chatkit.feedback_types import SubmitFeedbackSessionPayload


def test_submit_feedback_session_payload_allows_selected_option_without_message() -> None:
    payload = SubmitFeedbackSessionPayload.model_validate(
        {
            "session_id": "fbs_123",
            "selected_option": "The chart never appeared.",
            "sentiment": "negative",
        }
    )

    assert payload.session_id == "fbs_123"
    assert payload.selected_option == "The chart never appeared."
    assert payload.sentiment == "negative"
    assert payload.message is None
