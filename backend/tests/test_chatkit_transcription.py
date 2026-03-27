import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from chatkit.types import AudioInput

from backend.app.agents.context import FarmAgentContext
from backend.app.chatkit.server import FarmChatKitServer
from backend.app.chatkit.usage import (
    accumulate_transcription_usage,
    calculate_transcription_cost_usd,
)
from backend.app.services.credit_service import CreditService


class FakeTranscriptionsClient:
    def __init__(self, *, result: object | None = None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> object:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


def test_transcribe_webm_uses_json_response_format_and_skips_billing_without_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        log_calls: list[tuple[str, dict[str, object]]] = []
        credit_calls: list[dict[str, object]] = []
        transcription_client = FakeTranscriptionsClient(
            result=SimpleNamespace(text="hello from dictation")
        )
        server = _build_server(transcription_client)
        original_metadata = {
            "origin": "interactive",
            "usage": {
                "input_tokens": 3,
                "output_tokens": 5,
                "cost_usd": 1.25,
            },
        }
        context = _build_context(thread_metadata=original_metadata)

        monkeypatch.setattr(
            "backend.app.chatkit.server.log_event",
            lambda _logger, _level, event, **fields: log_calls.append((event, fields)),
        )

        async def fake_record_cost_event(**kwargs: object) -> None:
            credit_calls.append(dict(kwargs))

        monkeypatch.setattr(CreditService, "record_cost_event", fake_record_cost_event)

        result = await server.transcribe(
            AudioInput(data=b"webm-audio", mime_type="audio/webm;codecs=opus"),
            context,
        )

        create_call = transcription_client.calls[0]
        assert create_call["file"] == ("dictation.webm", b"webm-audio", "audio/webm")
        assert create_call["model"] == "gpt-4o-mini-transcribe"
        assert create_call["response_format"] == "json"
        assert result.text == "hello from dictation"
        assert context.thread_metadata == original_metadata
        assert credit_calls == []
        assert [event for event, _fields in log_calls] == [
            "transcribe.start",
            "transcribe.end",
        ]
        assert "filename=dictation.webm" in str(log_calls[0][1]["audio"])
        assert "billing_data=false" in str(log_calls[1][1]["result"])

    asyncio.run(_run())


def test_transcribe_mp4_uses_matching_mp4_filename(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        transcription_client = FakeTranscriptionsClient(
            result=SimpleNamespace(text="mp4 transcript")
        )
        server = _build_server(transcription_client)
        context = _build_context()

        monkeypatch.setattr("backend.app.chatkit.server.log_event", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(CreditService, "record_cost_event", _async_noop)

        await server.transcribe(
            AudioInput(data=b"mp4-audio", mime_type="audio/mp4;codecs=mp4a.40.2"),
            context,
        )

        create_call = transcription_client.calls[0]
        assert create_call["file"] == ("dictation.mp4", b"mp4-audio", "audio/mp4")
        assert create_call["response_format"] == "json"

    asyncio.run(_run())


def test_transcribe_records_usage_and_cost_when_duration_is_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        credit_calls: list[dict[str, object]] = []
        transcription_client = FakeTranscriptionsClient(
            result=SimpleNamespace(
                text="timed transcript",
                usage=SimpleNamespace(seconds=30.0),
            )
        )
        server = _build_server(transcription_client)
        initial_usage = {
            "input_tokens": 7,
            "output_tokens": 11,
            "cost_usd": 2.5,
        }
        context = _build_context(thread_metadata={"usage": initial_usage})

        monkeypatch.setattr("backend.app.chatkit.server.log_event", lambda *_args, **_kwargs: None)

        async def fake_record_cost_event(**kwargs: object) -> None:
            credit_calls.append(dict(kwargs))

        monkeypatch.setattr(CreditService, "record_cost_event", fake_record_cost_event)

        result = await server.transcribe(
            AudioInput(data=b"ogg-audio", mime_type="audio/ogg"),
            context,
        )

        expected_usage = accumulate_transcription_usage(
            initial_usage,
            model="gpt-4o-mini-transcribe",
            seconds=30.0,
        )
        assert result.text == "timed transcript"
        assert context.thread_metadata["usage"] == expected_usage
        assert credit_calls == [
            {
                "user_id": context.user_id,
                "thread_id": context.chat_id,
                "cost_usd": calculate_transcription_cost_usd(
                    "gpt-4o-mini-transcribe",
                    30.0,
                ),
            }
        ]

    asyncio.run(_run())


def test_transcribe_logs_and_reraises_failures_without_mutating_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        log_calls: list[tuple[str, dict[str, object]]] = []
        credit_calls: list[dict[str, object]] = []
        transcription_client = FakeTranscriptionsClient(error=RuntimeError("boom"))
        server = _build_server(transcription_client)
        original_metadata = {
            "origin": "interactive",
            "usage": {
                "input_tokens": 1,
                "output_tokens": 2,
                "cost_usd": 0.5,
            },
        }
        context = _build_context(thread_metadata=original_metadata)

        monkeypatch.setattr(
            "backend.app.chatkit.server.log_event",
            lambda _logger, _level, event, **fields: log_calls.append((event, fields)),
        )

        async def fake_record_cost_event(**kwargs: object) -> None:
            credit_calls.append(dict(kwargs))

        monkeypatch.setattr(CreditService, "record_cost_event", fake_record_cost_event)

        with pytest.raises(RuntimeError, match="boom"):
            await server.transcribe(
                AudioInput(data=b"bad-audio", mime_type="audio/webm"),
                context,
            )

        assert context.thread_metadata == original_metadata
        assert credit_calls == []
        assert [event for event, _fields in log_calls] == [
            "transcribe.start",
            "transcribe.error",
        ]
        assert "RuntimeError: boom" == log_calls[1][1]["error"]

    asyncio.run(_run())


def _build_server(transcription_client: FakeTranscriptionsClient) -> FarmChatKitServer:
    server = object.__new__(FarmChatKitServer)
    server.openai_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=transcription_client)
    )
    return server


def _build_context(
    *,
    thread_metadata: dict[str, object] | None = None,
) -> FarmAgentContext:
    return FarmAgentContext(
        chat_id="chat_123",
        user_id="user_123",
        user_email="user@example.com",
        db=SimpleNamespace(),
        farm_id="farm_123",
        farm_name="Walnut orchard",
        thread_metadata=dict(thread_metadata or {}),
    )


async def _async_noop(**_kwargs: object) -> None:
    return None
