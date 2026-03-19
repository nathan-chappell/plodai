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
