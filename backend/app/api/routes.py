from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from backend.app.core.auth import (
    AuthenticatedUser,
    require_current_user,
)
from backend.app.db.session import get_db
from backend.app.schemas.auth import UserResponse
from backend.app.schemas.report import (
    CreateReportRequest,
    CreateReportResponse,
    ReportResponse,
)
from backend.app.services.report_service import ReportService


router = APIRouter(prefix="/api")


@router.get("/auth/me", response_model=UserResponse)
async def me(user: AuthenticatedUser = Depends(require_current_user)):
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
    )


@router.get("/chatkit/threads")
async def list_chat_threads(
    user: AuthenticatedUser = Depends(require_current_user),
    chatkit_server: ReportFoundryChatKitServer = Depends(build_chatkit_server),
) -> dict:
    return {"threads": await chatkit_server.list_threads_for_user(user.id)}


@router.post("/reports", response_model=CreateReportResponse)
async def create_report(
    payload: CreateReportRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ReportService(db).create_report(user_id=user.id, payload=payload)


@router.get("/reports/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    report = await ReportService(db).get_report(report_id=report_id, user_id=user.id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found.",
        )
    return report
