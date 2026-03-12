import os
from contextlib import asynccontextmanager

from chatkit.server import StreamingResult
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api.routes import router
from backend.app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from backend.app.core.auth import AuthenticatedUser, require_current_user
from backend.app.core.config import get_settings
from backend.app.core.logging import configure_logging, get_logger
from backend.app.db.session import AsyncSessionLocal, Base, engine
from backend.app.services.auth_service import AuthService


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await AuthService(db).bootstrap()
        await db.commit()

    logger.info(
        "startup.complete env=%s port=%s static_path=%s database_url=%s",
        settings.app_env,
        settings.port,
        settings.static_path,
        settings.database_url,
    )
    yield


configure_logging()
settings = get_settings()
logger = get_logger("main")
if settings.openai_api_key:
    os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)

app = FastAPI(
    title="Report Foundry API",
    version="0.4.4",
    description="Agentic CSV analysis demo backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

static_path = settings.static_path
if static_path.exists():
    assets_path = static_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chatkit")
async def chatkit_entrypoint(
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    chatkit_server: ReportFoundryChatKitServer = Depends(build_chatkit_server),
):
    raw_request = await request.body()
    context = await chatkit_server.build_request_context(
        raw_request, user_email=user.email
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
