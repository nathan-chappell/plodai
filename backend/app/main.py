from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from app.core.auth import AuthenticatedUser, require_current_user
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal, Base, engine
from app.models.chatkit import ChatItem, ChatThread
from app.models.report import ReportRun
from app.models.user import User
from app.services.auth_service import AuthService


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await AuthService(db).bootstrap()

    yield


settings = get_settings()
app = FastAPI(
    title="Report Foundry API",
    version="0.4.0",
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
    return await chatkit_server.handle_request(request, user_email=user.email)


@app.get("/{full_path:path}")
async def spa_entrypoint(full_path: str):
    index_path = static_path / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    candidate = static_path / full_path
    if full_path and candidate.exists() and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(index_path)
