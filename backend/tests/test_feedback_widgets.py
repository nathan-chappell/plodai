from backend.app.agents.widgets import build_feedback_capture_widget


def test_build_feedback_capture_widget_has_submit_and_cancel_actions() -> None:
    widget = build_feedback_capture_widget(
        {
            "id": "fb_123",
            "thread_id": "thr_123",
            "item_ids": ["msg_123"],
            "user_email": "user@example.com",
            "origin": "interactive",
        }
    )

    assert widget["type"] == "Card"
    assert widget["asForm"] is True
    assert widget["confirm"]["action"]["type"] == "submit_feedback_details"
    assert widget["cancel"]["action"]["type"] == "cancel_feedback_details"
