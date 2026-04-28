from backend.app.core.config import summarize_database_url_for_log


def test_summarize_database_url_for_log_redacts_credentials() -> None:
    summary = summarize_database_url_for_log(
        "postgresql://postgres:secret@example.com:5432/railway?sslmode=require"
    )

    assert summary == "postgresql://<credentials>@example.com:5432/railway"
    assert "secret" not in summary


def test_summarize_database_url_for_log_leaves_sqlite_path() -> None:
    assert (
        summarize_database_url_for_log("sqlite:///./plodai.db")
        == "sqlite:///./plodai.db"
    )
