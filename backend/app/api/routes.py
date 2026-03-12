from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.server import ReportFoundryChatKitServer, build_chatkit_server
from backend.app.core.auth import (
    AuthenticatedUser,
    require_admin_user,
    require_current_user,
)
from backend.app.db.session import get_db
from backend.app.schemas.auth import (
    AuthTokenResponse,
    CreateUserRequest,
    LoginRequest,
    UserListResponse,
    UserResponse,
)
from backend.app.schemas.report import CreateReportRequest, CreateReportResponse, ReportResponse
from backend.app.services.auth_service import AuthService
from backend.app.services.report_service import ReportService


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


@router.get("/auth/users", response_model=UserListResponse)
async def list_users(
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    service = AuthService(db)
    users = await service.list_users()
    return UserListResponse(users=[service.to_user_response(user) for user in users])


@router.post("/auth/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    service = AuthService(db)
    try:
        user = await service.create_user(payload)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    return service.to_user_response(user)


@router.delete("/auth/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin_user: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    if admin_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete the currently signed-in admin user.",
        )

    deleted = await AuthService(db).delete_user(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
