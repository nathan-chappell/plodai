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

from backend.app.api.routes import router
from backend.app.chatkit.server import (
    FarmChatKitServer,
    build_chatkit_server,
)
from backend.app.core.auth import AuthenticatedUser, require_paid_user
from backend.app.core.config import get_settings
from backend.app.core.logging import configure_logging, get_logger, log_event
from backend.app.db.session import Base, engine
from backend.app.models.registry import import_models
from backend.app.services.bucket_storage import RailwayBucketService

ROOT_DIR = Path(__file__).resolve().parents[2]
PACKAGE_JSON = ROOT_DIR / "package.json"


def _read_version() -> str:
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return "unknown"
    version = data.get("version")
    return version if isinstance(version, str) and version else "unknown"
@asynccontextmanager
async def lifespan(_: FastAPI):
    import_models()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    bucket_service = RailwayBucketService(settings)
    if bucket_service.is_configured():
        configured_bucket_name = getattr(
            getattr(bucket_service, "settings", None),
            "storage_bucket_name",
            None,
        )
        try:
            await bucket_service.ensure_cors(
                allowed_origins=list(
                    dict.fromkeys(
                        [
                            *settings.CORS_ORIGINS,
                            *EXTRA_CHATKIT_CORS_ORIGINS,
                        ]
                    )
                )
            )
            log_event(
                logger,
                logging.INFO,
                "startup.storage_cors_configured",
                bucket=configured_bucket_name,
            )
        except Exception:
            log_event(
                logger,
                logging.WARNING,
                "startup.storage_cors_failed",
                bucket=configured_bucket_name,
            )

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
    title="PlodAI API",
    version="1.1.3",
    description="Farm-first PlodAI backend.",
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


@app.post("/api/farms/{farm_id}/chatkit")
async def farm_chatkit_entrypoint(
    farm_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(require_paid_user),
    chatkit_server: FarmChatKitServer = Depends(build_chatkit_server),
):
    raw_request = await request.body()
    context = await chatkit_server.build_request_context(
        raw_request,
        user_id=user.id,
        user_email=user.email,
        preferred_output_language=request.query_params.get("preferred_output_language"),
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
