import pytest

from backend.app.core.config import parse_cors_origins, summarize_database_url_for_log

pytestmark = pytest.mark.no_db


def test_summarize_database_url_for_log_redacts_credentials() -> None:
    summary = summarize_database_url_for_log(
        "postgresql://postgres:secret@example.com:5432/railway?sslmode=require"
    )

    assert summary == "postgresql://<credentials>@example.com:5432/railway"
    assert "secret" not in summary


def test_summarize_database_url_for_log_leaves_sqlite_path() -> None:
    assert (
        summarize_database_url_for_log("sqlite:///./report_foundry.db")
        == "sqlite:///./report_foundry.db"
    )


def test_parse_cors_origins_accepts_json_list() -> None:
    assert parse_cors_origins(
        '["http://localhost:5173","http://127.0.0.1:5173"]'
    ) == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_parse_cors_origins_accepts_unquoted_bracket_list() -> None:
    assert parse_cors_origins(
        "[http://localhost:5173,http://127.0.0.1:5173]"
    ) == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_parse_cors_origins_accepts_comma_separated_list() -> None:
    assert parse_cors_origins(
        "http://localhost:5173, http://127.0.0.1:5173"
    ) == ["http://localhost:5173", "http://127.0.0.1:5173"]
