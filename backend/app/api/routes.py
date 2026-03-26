from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
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
    AdminGrantCreditRequest,
    AdminGrantCreditResponse,
    AdminSetUserActiveRequest,
    AdminSetUserActiveResponse,
    AdminUserListResponse,
    AdminUserSummary,
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
