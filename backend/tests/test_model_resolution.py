from backend.app.chatkit.server import ClientWorkspaceChatKitServer


def test_map_requested_model_aliases() -> None:
    assert (
        ClientWorkspaceChatKitServer._map_requested_model("lightweight") == "gpt-4.1-mini"
    )
    assert ClientWorkspaceChatKitServer._map_requested_model("balanced") == "gpt-4.1"
    assert ClientWorkspaceChatKitServer._map_requested_model("powerful") == "gpt-5.1"
    assert ClientWorkspaceChatKitServer._map_requested_model("default") == "gpt-5.1"


def test_map_requested_model_passthrough_and_default() -> None:
    assert (
        ClientWorkspaceChatKitServer._map_requested_model("gpt-4.1-mini")
        == "gpt-4.1-mini"
    )
    assert ClientWorkspaceChatKitServer._map_requested_model(None) == "gpt-5.1"


def test_batch_mode_auto_continue_only_for_avoidable_follow_up_questions() -> None:
    assert ClientWorkspaceChatKitServer._should_auto_continue_batch(
        execution_mode="batch",
        continuation_used=False,
        assistant_text="Would you like me to split this by section next?",
    )
    assert not ClientWorkspaceChatKitServer._should_auto_continue_batch(
        execution_mode="interactive",
        continuation_used=False,
        assistant_text="Would you like me to split this by section next?",
    )
    assert not ClientWorkspaceChatKitServer._should_auto_continue_batch(
        execution_mode="batch",
        continuation_used=True,
        assistant_text="Would you like me to split this by section next?",
    )
    assert not ClientWorkspaceChatKitServer._should_auto_continue_batch(
        execution_mode="batch",
        continuation_used=False,
        assistant_text="I cannot continue because the required file is missing.",
    )
