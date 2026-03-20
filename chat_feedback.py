from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Annotated

import typer
from sqlalchemy import select

from backend.app.chatkit.feedback_types import FeedbackKind, FeedbackOrigin
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.chatkit import ChatItemFeedback, ChatThread

app = typer.Typer(help="Inspect structured ChatKit feedback captured in the client workspace.")


@app.command(name="list")
def list_feedback(
    email_contains: Annotated[str | None, typer.Option("--email-contains")] = None,
    kind: Annotated[FeedbackKind | None, typer.Option("--kind")] = None,
    origin: Annotated[FeedbackOrigin | None, typer.Option("--origin")] = None,
    thread_id: Annotated[str | None, typer.Option("--thread-id")] = None,
    has_message: Annotated[bool | None, typer.Option("--has-message/--no-has-message")] = None,
    limit: Annotated[int, typer.Option("--limit", min=1, max=200)] = 25,
) -> None:
    asyncio.run(
        _list_feedback(
            email_contains=email_contains,
            kind=kind,
            origin=origin,
            thread_id=thread_id,
            has_message=has_message,
            limit=limit,
        )
    )


@app.command(name="thread")
def show_thread(thread_id: str) -> None:
    asyncio.run(_show_thread_feedback(thread_id))


async def _list_feedback(
    *,
    email_contains: str | None,
    kind: FeedbackKind | None,
    origin: FeedbackOrigin | None,
    thread_id: str | None,
    has_message: bool | None,
    limit: int,
) -> None:
    async with AsyncSessionLocal() as db:
        query = select(ChatItemFeedback, ChatThread.title).join(
            ChatThread, ChatThread.id == ChatItemFeedback.thread_id
        )
        if email_contains:
            query = query.where(ChatItemFeedback.user_email.ilike(f"%{email_contains.strip().lower()}%"))
        if kind is not None:
            query = query.where(ChatItemFeedback.kind == kind)
        if origin is not None:
            query = query.where(ChatItemFeedback.origin == origin)
        if thread_id:
            query = query.where(ChatItemFeedback.thread_id == thread_id)
        if has_message is True:
            query = query.where(ChatItemFeedback.message.is_not(None))
        if has_message is False:
            query = query.where(ChatItemFeedback.message.is_(None))
        query = query.order_by(ChatItemFeedback.created_at.desc()).limit(limit)
        result = await db.execute(query)
        rows = result.all()

    if not rows:
        typer.echo("No feedback rows matched.")
        return

    for feedback, title in rows:
        typer.echo(
            " | ".join(
                [
                    _format_datetime(feedback.created_at),
                    feedback.thread_id,
                    title or "Untitled thread",
                    feedback.kind or "draft",
                    feedback.origin,
                    feedback.user_email or "-",
                    ",".join(feedback.item_ids_json) or "-",
                    _message_preview(feedback.message),
                ]
            )
        )


async def _show_thread_feedback(thread_id: str) -> None:
    async with AsyncSessionLocal() as db:
        thread = await db.get(ChatThread, thread_id)
        if thread is None:
            typer.echo(f"Thread not found: {thread_id}")
            raise typer.Exit(1)
        result = await db.execute(
            select(ChatItemFeedback)
            .where(ChatItemFeedback.thread_id == thread_id)
            .order_by(ChatItemFeedback.created_at.desc())
        )
        rows = list(result.scalars().all())

    typer.echo(f"Thread: {thread.title or 'Untitled thread'}")
    typer.echo(f"Thread id: {thread.id}")
    typer.echo(f"Feedback rows: {len(rows)}")
    for feedback in rows:
        typer.echo(f"- id: {feedback.id}")
        typer.echo(f"  created: {_format_datetime(feedback.created_at)}")
        typer.echo(f"  email: {feedback.user_email or '-'}")
        typer.echo(f"  kind: {feedback.kind or 'draft'}")
        typer.echo(f"  origin: {feedback.origin}")
        typer.echo(f"  item_ids: {', '.join(feedback.item_ids_json) or '-'}")
        typer.echo(f"  message: {feedback.message or '-'}")


def _format_datetime(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def _message_preview(value: str | None) -> str:
    if not value:
        return "-"
    return value if len(value) <= 96 else f"{value[:93]}..."


def main() -> None:
    app()


if __name__ == "__main__":
    main()
