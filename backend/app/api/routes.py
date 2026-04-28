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
from backend.app.schemas.farm import (
    FarmCreateRequest,
    FarmDeleteResponse,
    FarmDetail,
    FarmImageDeleteResponse,
    FarmImageUploadResponse,
    FarmRecordResponse,
    FarmRecordUpdateRequest,
    FarmSummary,
    FarmUpdateRequest,
    PublicFarmOrderResponse,
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
from backend.app.services.farm_image_service import FarmImageService
from backend.app.services.farm_service import FarmService
from backend.app.services.free_credits import FreeCreditService
from backend.app.services.payments import PaymentService
from backend.app.services.plodai_entity_service import PlodaiEntityService
from backend.app.services.public_farm_order_service import PublicFarmOrderService

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


@router.get("/farms", response_model=list[FarmSummary])
async def list_farms(
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await FarmService(db).list_farms(user_id=user.id)


@router.post("/farms", response_model=FarmDetail)
async def create_farm(
    payload: FarmCreateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    farm_service = FarmService(db)
    image_service = FarmImageService(db)
    farm = await farm_service.create_farm(user_id=user.id, request=payload)
    return farm.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                farm_id=farm.id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.get("/farms/{farm_id}", response_model=FarmDetail)
async def get_farm(
    farm_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    farm_service = FarmService(db)
    image_service = FarmImageService(db)
    farm = await farm_service.get_farm(user_id=user.id, farm_id=farm_id)
    return farm.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                farm_id=farm_id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.patch("/farms/{farm_id}", response_model=FarmDetail)
async def patch_farm(
    farm_id: str,
    payload: FarmUpdateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    farm_service = FarmService(db)
    image_service = FarmImageService(db)
    farm = await farm_service.update_farm(
        user_id=user.id,
        farm_id=farm_id,
        request=payload,
    )
    return farm.model_copy(
        update={
            "images": await image_service.list_images(
                user_id=user.id,
                farm_id=farm_id,
                public_base_url=resolve_public_base_url(str(request.base_url)),
            )
        }
    )


@router.delete("/farms/{farm_id}", response_model=FarmDeleteResponse)
async def delete_farm(
    farm_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    await FarmService(db).delete_farm(user_id=user.id, farm_id=farm_id)
    return FarmDeleteResponse(farm_id=farm_id, deleted=True)


@router.get("/farms/{farm_id}/record", response_model=FarmRecordResponse)
async def get_farm_record(
    farm_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await FarmService(db).get_record(user_id=user.id, farm_id=farm_id)
    return FarmRecordResponse(farm_id=farm_id, record=record)


@router.put("/farms/{farm_id}/record", response_model=FarmRecordResponse)
async def put_farm_record(
    farm_id: str,
    payload: FarmRecordUpdateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await FarmService(db).save_record(
        user_id=user.id,
        farm_id=farm_id,
        record=payload.record,
    )
    return FarmRecordResponse(farm_id=farm_id, record=record)


@router.post("/farms/{farm_id}/images", response_model=FarmImageUploadResponse)
async def upload_farm_image(
    farm_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    file_bytes = await file.read()
    image = await FarmImageService(db).upload_image(
        user_id=user.id,
        farm_id=farm_id,
        file_name=file.filename or "farm-image",
        mime_type=file.content_type,
        file_bytes=file_bytes,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
    return FarmImageUploadResponse(image=image)


@router.delete(
    "/farms/{farm_id}/images/{image_id}",
    response_model=FarmImageDeleteResponse,
)
async def delete_farm_image(
    farm_id: str,
    image_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    await FarmImageService(db).delete_image(
        user_id=user.id,
        farm_id=farm_id,
        image_id=image_id,
    )
    return FarmImageDeleteResponse(farm_id=farm_id, image_id=image_id, deleted=True)


@router.post(
    "/farms/{farm_id}/entities/search",
    response_model=PlodaiEntitySearchResponse,
)
async def search_farm_entities(
    farm_id: str,
    payload: PlodaiEntitySearchRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await PlodaiEntityService(db).search_entities(
        user_id=user.id,
        farm_id=farm_id,
        query=payload.query,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )


@router.get(
    "/public/farms/{farm_id}/orders/{order_id}",
    response_model=PublicFarmOrderResponse,
)
async def get_public_farm_order(
    farm_id: str,
    order_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await PublicFarmOrderService(db).get_public_order(
        farm_id=farm_id,
        order_id=order_id,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
