from backend.app.chatkit.server import (
    ClientWorkspaceChatKitServer,
    _model_settings_override_for_model,
)


def test_map_requested_model_aliases() -> None:
    assert (
        ClientWorkspaceChatKitServer._map_requested_model("lightweight")
        == "gpt-5.4-nano"
    )
    assert ClientWorkspaceChatKitServer._map_requested_model("balanced") == "gpt-5.4-mini"
    assert ClientWorkspaceChatKitServer._map_requested_model("powerful") == "gpt-5.4"
    assert ClientWorkspaceChatKitServer._map_requested_model("default") == "gpt-5.4-mini"


def test_map_requested_model_passthrough_and_default() -> None:
    assert (
        ClientWorkspaceChatKitServer._map_requested_model("gpt-5.4-mini")
        == "gpt-5.4-mini"
    )
    assert ClientWorkspaceChatKitServer._map_requested_model(None) == "gpt-5.4-mini"


def test_gpt_5_4_models_get_reasoning_summary_override() -> None:
    settings = _model_settings_override_for_model("gpt-5.4-mini")

    assert settings is not None
    assert settings.reasoning is not None
    assert settings.reasoning.effort == "low"
    assert settings.reasoning.summary == "auto"


def test_non_gpt_5_4_models_skip_reasoning_override() -> None:
    assert _model_settings_override_for_model("gpt-4.1") is None
