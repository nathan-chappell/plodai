import json
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
from backend.app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from backend.app.core.auth import AuthenticatedUser, require_current_user
from backend.app.core.config import get_settings
from backend.app.core.logging import configure_logging, get_logger
from backend.app.db.session import AsyncSessionLocal, Base, engine
from backend.app.services.auth_service import AuthService

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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await AuthService(db).bootstrap()
        await db.commit()

    logger.info(
        f"startup.complete database_url={settings.database_url} openai_max_retries={settings.openai_max_retries}"
    )
    yield


configure_logging()
print(f"report-foundry api version={_read_version()}")
print(f"report-foundry api root={ROOT_DIR}")
settings = get_settings()
logger = get_logger("main")
if settings.OPENAI_API_KEY:
    os.environ.setdefault("OPENAI_API_KEY", settings.OPENAI_API_KEY)
    default_openai_client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        max_retries=settings.openai_max_retries,
    )
    set_default_openai_client(default_openai_client)
    logger.info(
        f"openai.default_client_configured max_retries={settings.openai_max_retries}"
    )

app = FastAPI(
    title="Report Foundry API",
    version="0.8.1",
    description="Agentic CSV analysis demo backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

static_path = Path() / "dist"
assets_path = static_path / "assets"

if static_path.exists() and assets_path.exists():
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
else:
    raise RuntimeError(f"Missing static or assets path: {assets_path.exists()=}")


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
