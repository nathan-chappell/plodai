from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import (
    AuthenticatedUser,
    require_admin_user,
    require_current_user,
)
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
from backend.app.services.clerk_admin_service import (
    list_users,
    map_user_summary,
    set_user_active_state,
)
from backend.app.services.credit_service import CreditService


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
    credit_service = CreditService(db)
    balance = await credit_service.get_or_create_balance(user_id)
    return AdminSetUserActiveResponse(
        user_id=user_id,
        is_active=user_summary["is_active"],
        current_credit_usd=balance.current_credit_usd,
        credit_floor_usd=user_summary["credit_floor_usd"],
    )
