from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser, require_current_user
from app.db.session import get_db
from app.schemas.auth import AuthTokenResponse, LoginRequest, UserResponse
from app.schemas.report import CreateReportRequest, CreateReportResponse, ReportResponse
from app.services.auth_service import AuthService
from app.services.report_service import ReportService


router = APIRouter(prefix="/api")


@router.post("/auth/login", response_model=AuthTokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    result = AuthService(db).login(payload.email, payload.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token, user = result
    return AuthTokenResponse(
        access_token=token,
        user=AuthService(db).to_user_response(user),
    )


@router.get("/auth/me", response_model=UserResponse)
def me(user: AuthenticatedUser = Depends(require_current_user)):
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
    )


@router.post("/reports", response_model=CreateReportResponse)
def create_report(
    payload: CreateReportRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    return ReportService(db).create_report(user_id=user.email, payload=payload)


@router.get("/reports/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    report = ReportService(db).get_report(report_id=report_id, user_id=user.email)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found.",
        )
    return report


@router.get("/chatkit/status")
def chatkit_status(user: AuthenticatedUser = Depends(require_current_user)) -> dict[str, str]:
    return {
        "status": "scaffolded",
        "note": "ChatKit and Agents SDK hooks are in place. Persistence wiring is intentionally paused.",
        "user": user.email,
    }
