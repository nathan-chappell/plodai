from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.auth import require_user
from app.db.session import get_db
from app.schemas.report import CreateReportRequest, CreateReportResponse, ReportResponse
from app.services.report_service import ReportService


router = APIRouter(prefix="/api")


@router.get("/me")
def me(user_id: str = Depends(require_user)) -> dict[str, str]:
    return {"user": user_id}


@router.post("/reports", response_model=CreateReportResponse)
def create_report(
    payload: CreateReportRequest,
    user_id: str = Depends(require_user),
    db: Session = Depends(get_db),
):
    return ReportService(db).create_report(user_id=user_id, payload=payload)


@router.get("/reports/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: str,
    user_id: str = Depends(require_user),
    db: Session = Depends(get_db),
):
    report = ReportService(db).get_report(report_id=report_id, user_id=user_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found.",
        )
    return report
