from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from app.core.auth import AuthenticatedUser, require_current_user
from app.db.session import get_db
from app.schemas.auth import AuthTokenResponse, LoginRequest, UserResponse
from app.schemas.report import CreateReportRequest, CreateReportResponse, ReportResponse
from app.services.auth_service import AuthService
from app.services.report_service import ReportService


router = APIRouter(prefix="/api")


@router.post("/auth/login", response_model=AuthTokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    result = await service.login(payload.email, payload.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token, user = result
    return AuthTokenResponse(access_token=token, user=service.to_user_response(user))


@router.get("/auth/me", response_model=UserResponse)
async def me(user: AuthenticatedUser = Depends(require_current_user)):
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
    )


@router.get("/chatkit/config")
async def get_chatkit_config(
    user: AuthenticatedUser = Depends(require_current_user),
    chatkit_server: ReportFoundryChatKitServer = Depends(build_chatkit_server),
) -> dict:
    return {
        "user": user.email,
        "model": chatkit_server.frontend_config.model,
        "tools": chatkit_server.frontend_config.tools,
        "notes": chatkit_server.frontend_config.notes,
        "server_ready": chatkit_server.server is not None,
    }


@router.get("/chatkit/threads")
async def list_chat_threads(
    user: AuthenticatedUser = Depends(require_current_user),
    chatkit_server: ReportFoundryChatKitServer = Depends(build_chatkit_server),
) -> dict:
    return {"threads": await chatkit_server.list_threads_for_user(user.email)}


@router.post("/reports", response_model=CreateReportResponse)
async def create_report(
    payload: CreateReportRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ReportService(db).create_report(user_id=user.email, payload=payload)


@router.get("/reports/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    report = await ReportService(db).get_report(report_id=report_id, user_id=user.email)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found.",
        )
    return report
