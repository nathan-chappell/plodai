from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import (
    AuthenticatedUser,
    require_admin_user,
    require_current_user,
)
from backend.app.core.config import resolve_public_base_url
from backend.app.db.session import get_db
from backend.app.schemas.auth import UserResponse
from backend.app.schemas.credits import (
    AdminFreeCreditDecisionRequest,
    AdminGrantCreditRequest,
    AdminGrantCreditResponse,
    AdminPaymentAttemptDecisionRequest,
    AdminSetUserActiveRequest,
    AdminSetUserActiveResponse,
    AdminUserListResponse,
    AdminUserSummary,
    FreeCreditRequestCreate,
    FreeCreditRequestListResponse,
    FreeCreditRequestStatus,
    FreeCreditRequestSummary,
    PaymentAttemptListResponse,
    PaymentAttemptStatus,
    PaymentAttemptSummary,
    PaymentIntegrationResponse,
    PayPalPaymentAttemptCreateRequest,
)
from backend.app.schemas.advisory import (
    AdvisoryCaseCreateRequest,
    AdvisoryCaseDeleteResponse,
    AdvisoryCaseDetail,
    AdvisoryImageDeleteResponse,
    AdvisoryImageUploadResponse,
    AdvisoryRecordResponse,
    AdvisoryRecordUpdateRequest,
    AdvisoryCaseSummary,
    AdvisoryCaseUpdateRequest,
)
from backend.app.schemas.plodai_entities import (
    PlodaiEntitySearchRequest,
    PlodaiEntitySearchResponse,
)
from backend.app.services.clerk_admin_service import (
    list_users,
    map_user_summary,
    set_user_active_state,
)
from backend.app.services.credit_service import CreditService
from backend.app.services.advisory_image_service import AdvisoryImageService
from backend.app.services.advisory_service import AdvisoryService
from backend.app.services.free_credits import FreeCreditService
from backend.app.services.payments import PaymentService
from backend.app.services.plodai_entity_service import PlodaiEntityService

router = APIRouter(prefix="/api")


@router.get("/auth/me", response_model=UserResponse)
async def me(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    balance = await CreditService(db).get_or_create_balance(user.id)
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        current_credit_usd=balance.current_credit_usd,
        credit_floor_usd=user.credit_floor_usd,
    )


@router.get("/billing/payment-status", response_model=PaymentIntegrationResponse)
async def payment_status(
    _: AuthenticatedUser = Depends(require_current_user),
):
    from backend.app.core.config import get_settings

    settings = get_settings()
    paypal_recipient_email = settings.paypal_recipient_email.strip() if settings.paypal_recipient_email else None
    return PaymentIntegrationResponse(
        provider="paypal" if paypal_recipient_email else "none",
        checkout_enabled=False,
        receipt_upload_enabled=paypal_recipient_email is not None,
        reason=(
            "Send a PayPal payment, include the generated reference code, then upload the receipt for receipt-backed credit."
            if paypal_recipient_email
            else "Payment receipt uploads are not configured."
        ),
        paypal_recipient_email=paypal_recipient_email,
        paypal_payment_url=str(settings.paypal_payment_url) if settings.paypal_payment_url else None,
        min_payment_usd=settings.paypal_min_payment_usd,
        max_payment_usd=settings.paypal_max_payment_usd,
    )


@router.get("/billing/paypal/attempts", response_model=PaymentAttemptListResponse)
async def list_paypal_attempts(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempts = await PaymentService(db).list_user_attempts(user_id=user.id)
    return PaymentAttemptListResponse(attempts=attempts)


@router.post("/billing/paypal/attempts", response_model=PaymentAttemptSummary)
async def create_paypal_attempt(
    payload: PayPalPaymentAttemptCreateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await PaymentService(db).create_paypal_attempt(
            user_id=user.id,
            expected_amount_usd=payload.expected_amount_usd,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/billing/paypal/attempts/{attempt_id}/receipt", response_model=PaymentAttemptSummary)
async def upload_paypal_receipt(
    attempt_id: str,
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    payload = await file.read()
    if len(payload) > 5_000_000:
        raise HTTPException(status_code=413, detail="Receipt upload is too large.")
    try:
        return await PaymentService(db).review_receipt_upload(
            user_id=user.id,
            attempt_id=attempt_id,
            filename=file.filename or "receipt",
            media_type=file.content_type,
            payload=payload,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/billing/free-credit-requests", response_model=FreeCreditRequestListResponse)
async def list_free_credit_requests(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    requests = await FreeCreditService(db).list_user_requests(user_id=user.id)
    return FreeCreditRequestListResponse(requests=requests)


@router.post("/billing/free-credit-requests", response_model=FreeCreditRequestSummary)
async def create_free_credit_request(
    payload: FreeCreditRequestCreate,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await FreeCreditService(db).create_request(user_id=user.id, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/admin/credits/grant", response_model=AdminGrantCreditResponse)
async def grant_credit(
    payload: AdminGrantCreditRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    balance = await CreditService(db).grant_credit(
        payload.user_id.strip(),
        payload.credit_amount_usd,
        note=payload.note,
        admin_user_id=admin.id,
    )
    return AdminGrantCreditResponse(
        user_id=balance.user_id,
        current_credit_usd=balance.current_credit_usd,
    )


@router.get("/admin/users", response_model=AdminUserListResponse)
async def get_admin_users(
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    query: str | None = Query(default=None, max_length=200),
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    clerk_users = await list_users(limit=limit, offset=offset, query=query)
    credit_amounts = await CreditService(db).list_balance_amounts(
        [user.id for user in clerk_users]
    )
    items = [
        AdminUserSummary(
            **map_user_summary(clerk_user),
            current_credit_usd=round(float(credit_amounts.get(clerk_user.id, 0.0)), 8),
        )
        for clerk_user in clerk_users
    ]
    return AdminUserListResponse(
        items=items,
        limit=limit,
        offset=offset,
        has_more=len(clerk_users) == limit,
        query=query.strip() if query else None,
    )


@router.post("/admin/users/set-active", response_model=AdminSetUserActiveResponse)
async def set_user_active(
    payload: AdminSetUserActiveRequest,
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = payload.user_id.strip()
    user_summary = await set_user_active_state(user_id=user_id, active=payload.active)
    balance = await CreditService(db).get_or_create_balance(user_id)
    return AdminSetUserActiveResponse(
        user_id=user_id,
        is_active=user_summary["is_active"],
        current_credit_usd=balance.current_credit_usd,
        credit_floor_usd=user_summary["credit_floor_usd"],
    )


@router.get("/admin/payments", response_model=PaymentAttemptListResponse)
async def list_admin_payment_attempts(
    status_filter: PaymentAttemptStatus | None = Query(default=None, alias="status"),
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    attempts = await PaymentService(db).list_admin_attempts(status=status_filter)
    return PaymentAttemptListResponse(attempts=attempts)


@router.post("/admin/payments/decide", response_model=PaymentAttemptSummary)
async def decide_admin_payment_attempt(
    payload: AdminPaymentAttemptDecisionRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await PaymentService(db).decide_admin_attempt(
            attempt_id=payload.attempt_id,
            admin_user_id=admin.id,
            status=payload.status,
            decision_note=payload.decision_note,
            credit_amount_usd=payload.credit_amount_usd,
            provider_reference=payload.provider_reference,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/admin/free-credit-requests", response_model=FreeCreditRequestListResponse)
async def list_admin_free_credit_requests(
    status_filter: FreeCreditRequestStatus | None = Query(default=None, alias="status"),
    _: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    requests = await FreeCreditService(db).list_admin_requests(status=status_filter)
    return FreeCreditRequestListResponse(requests=requests)


@router.post("/admin/free-credit-requests/decide", response_model=FreeCreditRequestSummary)
async def decide_admin_free_credit_request(
    payload: AdminFreeCreditDecisionRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await FreeCreditService(db).decide_admin_request(
            request_id=payload.request_id,
            admin_user_id=admin.id,
            status=payload.status,
            decision_note=payload.decision_note,
            credit_amount_usd=payload.credit_amount_usd,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/advisory/cases", response_model=list[AdvisoryCaseSummary])
async def list_advisory_cases(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdvisoryService(db).list_cases(user_id=user.id)


@router.post("/advisory/cases", response_model=AdvisoryCaseDetail)
async def create_advisory_case(
    payload: AdvisoryCaseCreateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    advisory_service = AdvisoryService(db)
    image_service = AdvisoryImageService(db)
    advisory_case = await advisory_service.create_case(user_id=user.id, request=payload)
    return advisory_case.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                case_id=advisory_case.id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.get("/advisory/cases/{case_id}", response_model=AdvisoryCaseDetail)
async def get_advisory_case(
    case_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    advisory_service = AdvisoryService(db)
    image_service = AdvisoryImageService(db)
    advisory_case = await advisory_service.get_case(user_id=user.id, case_id=case_id)
    return advisory_case.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                case_id=case_id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.patch("/advisory/cases/{case_id}", response_model=AdvisoryCaseDetail)
async def patch_advisory_case(
    case_id: str,
    payload: AdvisoryCaseUpdateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    advisory_service = AdvisoryService(db)
    image_service = AdvisoryImageService(db)
    advisory_case = await advisory_service.update_case(
        user_id=user.id,
        case_id=case_id,
        request=payload,
    )
    return advisory_case.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                case_id=case_id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.delete("/advisory/cases/{case_id}", response_model=AdvisoryCaseDeleteResponse)
async def delete_advisory_case(
    case_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    await AdvisoryService(db).delete_case(user_id=user.id, case_id=case_id)
    return AdvisoryCaseDeleteResponse(case_id=case_id, deleted=True)


@router.get("/advisory/cases/{case_id}/record", response_model=AdvisoryRecordResponse)
async def get_case_record(
    case_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await AdvisoryService(db).get_record(user_id=user.id, case_id=case_id)
    return AdvisoryRecordResponse(case_id=case_id, record=record)


@router.put("/advisory/cases/{case_id}/record", response_model=AdvisoryRecordResponse)
async def put_advisory_record(
    case_id: str,
    payload: AdvisoryRecordUpdateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await AdvisoryService(db).save_record(
        user_id=user.id,
        case_id=case_id,
        record=payload.record,
    )
    return AdvisoryRecordResponse(case_id=case_id, record=record)


@router.post("/advisory/cases/{case_id}/images", response_model=AdvisoryImageUploadResponse)
async def upload_advisory_image(
    case_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    image = await AdvisoryImageService(db).upload_image(
        user_id=user.id,
        case_id=case_id,
        file_name=file.filename or "advisory-image",
        mime_type=file.content_type,
        file_bytes=file_bytes,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
    return AdvisoryImageUploadResponse(image=image)


@router.delete(
    "/advisory/cases/{case_id}/images/{image_id}",
    response_model=AdvisoryImageDeleteResponse,
)
async def delete_advisory_image(
    case_id: str,
    image_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    await AdvisoryImageService(db).delete_image(
        user_id=user.id,
        case_id=case_id,
        image_id=image_id,
    )
    return AdvisoryImageDeleteResponse(case_id=case_id, image_id=image_id, deleted=True)


@router.post(
    "/advisory/cases/{case_id}/entities/search",
    response_model=PlodaiEntitySearchResponse,
)
async def search_advisory_entities(
    case_id: str,
    payload: PlodaiEntitySearchRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await PlodaiEntityService(db).search_entities(
        user_id=user.id,
        case_id=case_id,
        query=payload.query,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
