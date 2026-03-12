from backend.app.chatkit.server import ReportFoundryChatKitServer


class StubSettingsServer(ReportFoundryChatKitServer):
    def _get_settings(self):
        return type(
            "SettingsStub",
            (),
            {
                "chatkit_lightweight_model": "gpt-4.1-mini",
                "chatkit_balanced_model": "gpt-4.1",
                "chatkit_default_model": "gpt-5.1",
                "openai_api_key": "",
            },
        )()


def build_server_with_stub_settings() -> ReportFoundryChatKitServer:
    return StubSettingsServer.__new__(StubSettingsServer)


def test_map_requested_model_aliases() -> None:
    server = build_server_with_stub_settings()

    assert server._map_requested_model("lightweight") == "gpt-4.1-mini"
    assert server._map_requested_model("balanced") == "gpt-4.1"
    assert server._map_requested_model("powerful") == "gpt-5.1"
    assert server._map_requested_model("default") == "gpt-5.1"


def test_map_requested_model_passthrough_and_default() -> None:
    server = build_server_with_stub_settings()

    assert server._map_requested_model("gpt-4.1-mini") == "gpt-4.1-mini"
    assert server._map_requested_model(None) == "gpt-5.1"
