from types import SimpleNamespace

from backend.app.chatkit.server import ClientWorkspaceChatKitServer


def test_map_requested_model_aliases() -> None:
    assert (
        ClientWorkspaceChatKitServer._map_requested_model("lightweight")
        == "gpt-4.1-mini"
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


def test_extract_batch_continuation_assistant_text_skips_tool_turns() -> None:
    recent_items = [
        SimpleNamespace(type="client_tool_call", status="pending"),
        SimpleNamespace(
            type="assistant_message",
            content=[SimpleNamespace(text="Older assistant reply.")],
        ),
    ]

    assert (
        ClientWorkspaceChatKitServer._extract_batch_continuation_assistant_text(
            recent_items
        )
        is None
    )


def test_extract_batch_continuation_assistant_text_uses_latest_terminal_reply() -> None:
    recent_items = [
        SimpleNamespace(type="workflow"),
        SimpleNamespace(
            type="assistant_message",
            content=[
                SimpleNamespace(text="  Continue with the strongest next step.  "),
                SimpleNamespace(text=""),
            ],
        ),
        SimpleNamespace(type="client_tool_call", status="completed"),
    ]

    assert (
        ClientWorkspaceChatKitServer._extract_batch_continuation_assistant_text(
            recent_items
        )
        == "Continue with the strongest next step."
    )
