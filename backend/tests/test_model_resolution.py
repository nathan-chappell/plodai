from backend.app.chatkit.server import ReportFoundryChatKitServer


def test_map_requested_model_aliases() -> None:
    assert (
        ReportFoundryChatKitServer._map_requested_model("lightweight") == "gpt-4.1-mini"
    )
    assert ReportFoundryChatKitServer._map_requested_model("balanced") == "gpt-4.1"
    assert ReportFoundryChatKitServer._map_requested_model("powerful") == "gpt-5.1"
    assert ReportFoundryChatKitServer._map_requested_model("default") == "gpt-5.1"


def test_map_requested_model_passthrough_and_default() -> None:
    assert (
        ReportFoundryChatKitServer._map_requested_model("gpt-4.1-mini")
        == "gpt-4.1-mini"
    )
    assert ReportFoundryChatKitServer._map_requested_model(None) == "gpt-5.1"
