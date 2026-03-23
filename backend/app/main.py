import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from agents import set_default_openai_client
from chatkit.server import StreamingResult
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from sqlalchemy import inspect

from backend.app.api.routes import router
from backend.app.chatkit.server import (
    ClientWorkspaceChatKitServer,
    build_chatkit_server,
)
from backend.app.core.auth import AuthenticatedUser, require_paid_user
from backend.app.core.config import get_settings
from backend.app.core.logging import configure_logging, get_logger, log_event
from backend.app.db.session import Base, engine
from backend.app.models.registry import import_models

ROOT_DIR = Path(__file__).resolve().parents[2]
PACKAGE_JSON = ROOT_DIR / "package.json"


def _read_version() -> str:
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "unknown"
    version = data.get("version")
    return version if isinstance(version, str) and version else "unknown"


def _should_reset_sqlite_schema(sync_conn) -> bool:
    inspector = inspect(sync_conn)
    table_names = set(inspector.get_table_names())
    if not table_names:
        return False

    expected_tables = {
        "workspaces",
        "workspace_items",
        "workspace_item_revisions",
        "workspace_chats",
        "workspace_chat_entries",
        "workspace_chat_attachments",
        "workspace_chat_feedback",
        "stored_openai_files",
    }
    legacy_tables = {
        "workspace_files",
        "workspace_artifacts",
        "workspace_artifact_revisions",
        "chat_threads",
        "chat_messages",
        "chat_attachments",
        "chat_feedback",
    }
    if legacy_tables & table_names:
        return True
    if not expected_tables.issubset(table_names):
        return True

    workspace_columns = {
        column["name"] for column in inspector.get_columns("workspaces")
    }
    return not {
        "app_id",
        "active_chat_id",
        "selected_item_id",
        "current_report_item_id",
    }.issubset(workspace_columns)


@asynccontextmanager
async def lifespan(_: FastAPI):
    import_models()
    async with engine.begin() as conn:
        should_reset = (
            settings.database_url.startswith("sqlite:///")
            and await conn.run_sync(_should_reset_sqlite_schema)
        )
        if should_reset:
            await conn.run_sync(Base.metadata.drop_all)
            log_event(
                logger,
                logging.WARNING,
                "startup.sqlite_schema_reset",
                detail="detected legacy local schema and rebuilt the database",
            )
        await conn.run_sync(Base.metadata.create_all)

    log_event(
        logger,
        logging.INFO,
        "startup.complete",
        database_url=settings.database_url,
        openai_max_retries=settings.openai_max_retries,
    )
    yield


configure_logging()
settings = get_settings()
logger = get_logger("main")
EXTRA_CHATKIT_CORS_ORIGINS = (
    "https://cdn.platform.openai.com",
    "https://platform.openai.com",
)
log_event(
    logger,
    logging.INFO,
    "startup.bootstrap",
    version=_read_version(),
    root_dir=str(ROOT_DIR),
)
if not settings.CLERK_SECRET_KEY:
    log_event(
        logger,
        logging.WARNING,
        "clerk.secret_key_missing",
        detail="auth routes will return 503 until CLERK_SECRET_KEY is configured",
    )
if settings.ENABLE_DEV_AUTH_BEARER:
    log_event(
        logger,
        logging.WARNING,
        "auth.dev_bearer_enabled",
        detail="local bearer token auth bypass is active",
    )
if settings.OPENAI_API_KEY:
    os.environ.setdefault("OPENAI_API_KEY", settings.OPENAI_API_KEY)
    default_openai_client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        max_retries=settings.openai_max_retries,
    )
    set_default_openai_client(default_openai_client)
    log_event(
        logger,
        logging.INFO,
        "openai.default_client_configured",
        max_retries=settings.openai_max_retries,
    )

app = FastAPI(
    title="AI Portfolio API",
    version="0.8.3",
    description="Agentic agent platform backend.",
    lifespan=lifespan,
)

cors_origins = list(dict.fromkeys([*settings.CORS_ORIGINS, *EXTRA_CHATKIT_CORS_ORIGINS]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
)

app.include_router(router)

static_path = ROOT_DIR / settings.static_dir
assets_path = static_path / "assets"


def _configure_frontend_assets(application: FastAPI) -> None:
    if not static_path.is_dir():
        log_event(
            logger,
            logging.WARNING,
            "frontend.static_dir_missing",
            static_path=str(static_path),
            detail="frontend build output is missing; API routes remain available",
        )
        return

    if not assets_path.is_dir():
        log_event(
            logger,
            logging.WARNING,
            "frontend.assets_dir_missing",
            static_path=str(static_path),
            assets_path=str(assets_path),
            detail="frontend assets directory is missing; API routes remain available",
        )
        return

    application.mount("/assets", StaticFiles(directory=assets_path), name="assets")


_configure_frontend_assets(app)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chatkit")
async def chatkit_entrypoint(
    request: Request,
    user: AuthenticatedUser = Depends(require_paid_user),
    chatkit_server: ClientWorkspaceChatKitServer = Depends(build_chatkit_server),
):
    raw_request = await request.body()
    context = await chatkit_server.build_request_context(
        raw_request, user_id=user.id, user_email=user.email
    )
    result = await chatkit_server.process(raw_request, context)
    if isinstance(result, StreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json, media_type="application/json")


@app.get("/{full_path:path}")
async def spa_entrypoint(full_path: str):
    index_path = static_path / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    candidate = static_path / full_path
    if full_path and candidate.exists() and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(index_path)
