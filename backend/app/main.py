from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

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
