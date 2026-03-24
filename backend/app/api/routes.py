import logging
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile as StarletteUploadFile

from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.core.auth import (
    AuthenticatedUser,
    require_admin_user,
    require_current_user,
)
from backend.app.core.logging import get_logger, log_event, summarize_pairs_for_log
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
from backend.app.schemas.stored_file import (
    ChatAttachmentDeleteResponse,
    ChatAttachmentUploadResponse,
    DeleteDocumentFileResponse,
    DocumentFileListResponse,
)
from backend.app.services.plodai_entity_service import PlodaiEntityService
from backend.app.services.stored_file_service import StoredFileService
from backend.app.schemas.workspace import (
    PublicFarmOrderResponse,
    WorkspaceCreatedItemDetail,
    WorkspaceCreateRequest,
    WorkspaceAppId,
    WorkspaceItemCreateRequest,
    WorkspaceItemDeleteResponse,
    WorkspaceItemDetail,
    WorkspaceItemOperationRequest,
    WorkspaceItemRevisionEntry,
    WorkspaceListItem,
    WorkspaceState,
    WorkspaceUpdateRequest,
    WorkspaceUploadCreateRequest,
    WorkspaceUploadDeleteResponse,
    WorkspaceUploadItemSummary,
)
from backend.app.services.public_farm_order_service import PublicFarmOrderService
from backend.app.services.workspace_service import (
    WorkspaceRevisionConflictError,
    WorkspaceService,
)


router = APIRouter(prefix="/api")
logger = get_logger("api.routes")


async def _extract_chat_attachment_upload_bytes(request: Request) -> bytes:
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in content_type:
        return await request.body()

    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, StarletteUploadFile):
        upload = next(
            (value for value in form.values() if isinstance(value, StarletteUploadFile)),
            None,
        )
    if not isinstance(upload, StarletteUploadFile):
        return b""

    try:
        return await upload.read()
    finally:
        await upload.close()


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


@router.get("/workspaces", response_model=list[WorkspaceListItem])
async def list_workspaces(
    app_id: WorkspaceAppId = Query(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).list_workspaces(user_id=user.id, app_id=app_id)


@router.post("/workspaces", response_model=WorkspaceState)
async def create_workspace(
    payload: WorkspaceCreateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).create_workspace(
        user_id=user.id,
        app_id=payload.app_id,
        name=payload.name,
        active_chat_id=payload.active_chat_id,
        selected_item_id=payload.selected_item_id,
        current_report_item_id=payload.current_report_item_id,
    )


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceState)
async def get_workspace(
    workspace_id: str,
    app_id: WorkspaceAppId = Query(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).get_workspace_state(
        user_id=user.id,
        workspace_id=workspace_id,
        app_id=app_id,
    )


@router.get(
    "/public/farm-orders/{workspace_id}/{order_id}",
    response_model=PublicFarmOrderResponse,
)
async def get_public_farm_order(
    workspace_id: str,
    order_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await PublicFarmOrderService(db).get_public_order(
        workspace_id=workspace_id,
        order_id=order_id,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceState)
async def patch_workspace(
    workspace_id: str,
    payload: WorkspaceUpdateRequest,
    app_id: WorkspaceAppId = Query(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).update_workspace(
        user_id=user.id,
        workspace_id=workspace_id,
        app_id=app_id,
        update=payload,
    )


@router.post(
    "/workspaces/{workspace_id}/uploads",
    response_model=WorkspaceUploadItemSummary,
)
async def create_workspace_upload(
    workspace_id: str,
    payload: WorkspaceUploadCreateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).create_upload(
        user_id=user.id,
        workspace_id=workspace_id,
        request=payload,
    )


@router.delete(
    "/workspaces/{workspace_id}/uploads/{item_id}",
    response_model=WorkspaceUploadDeleteResponse,
)
async def delete_workspace_upload(
    workspace_id: str,
    item_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).delete_upload(
        user_id=user.id,
        workspace_id=workspace_id,
        item_id=item_id,
    )


@router.post(
    "/workspaces/{workspace_id}/items",
    response_model=WorkspaceCreatedItemDetail,
)
async def create_workspace_item(
    workspace_id: str,
    payload: WorkspaceItemCreateRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).create_item(
        user_id=user.id,
        workspace_id=workspace_id,
        request=payload,
    )


@router.get(
    "/workspaces/{workspace_id}/items/{item_id}",
    response_model=WorkspaceItemDetail,
)
async def get_workspace_item(
    workspace_id: str,
    item_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).get_item_detail(
        user_id=user.id,
        workspace_id=workspace_id,
        item_id=item_id,
    )


@router.delete(
    "/workspaces/{workspace_id}/items/{item_id}",
    response_model=WorkspaceItemDeleteResponse,
)
async def delete_workspace_item(
    workspace_id: str,
    item_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).delete_item(
        user_id=user.id,
        workspace_id=workspace_id,
        item_id=item_id,
    )


@router.get(
    "/workspaces/{workspace_id}/items/{item_id}/revisions",
    response_model=list[WorkspaceItemRevisionEntry],
)
async def list_workspace_item_revisions(
    workspace_id: str,
    item_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await WorkspaceService(db).list_item_revisions(
        user_id=user.id,
        workspace_id=workspace_id,
        item_id=item_id,
    )


@router.post(
    "/workspaces/{workspace_id}/items/{item_id}/operations",
    response_model=WorkspaceCreatedItemDetail,
)
async def apply_workspace_item_operation(
    workspace_id: str,
    item_id: str,
    payload: WorkspaceItemOperationRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = WorkspaceService(db)
    try:
        return await service.apply_item_operation(
            user_id=user.id,
            workspace_id=workspace_id,
            item_id=item_id,
            request=payload,
        )
    except WorkspaceRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/chatkit/attachments/upload",
    response_model=ChatAttachmentUploadResponse,
)
async def upload_chatkit_attachment(
    request: Request,
    workspace_id: str = Form(...),
    app_id: WorkspaceAppId = Form(...),
    scope: str = Form("chat_attachment"),
    source_kind: str | None = Form(default=None),
    parent_file_id: str | None = Form(default=None),
    preview_json: str | None = Form(default=None),
    attachment_id: str | None = Form(default=None),
    thread_id: str | None = Form(default=None),
    create_attachment: bool = Form(default=True),
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    if scope not in {"chat_attachment", "document_thread_file"}:
        raise HTTPException(status_code=400, detail="Unsupported file scope.")
    if attachment_id is None and create_attachment:
        raise HTTPException(status_code=400, detail="attachment_id is required.")
    parsed_preview_json: dict[str, object] | None = None
    if preview_json:
        try:
            decoded_preview = json.loads(preview_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="preview_json must be valid JSON.") from exc
        if not isinstance(decoded_preview, dict):
            raise HTTPException(status_code=400, detail="preview_json must be a JSON object.")
        parsed_preview_json = decoded_preview
    file_bytes = await file.read()
    return await StoredFileService(db).create_chat_attachment_upload(
        user_id=user.id,
        workspace_id=workspace_id,
        app_id=app_id,
        file_name=file.filename or "upload.bin",
        mime_type=file.content_type,
        file_bytes=file_bytes,
        attachment_id=attachment_id or "",
        scope=scope,  # type: ignore[arg-type]
        thread_id=thread_id,
        create_attachment=create_attachment,
        source_kind=source_kind,  # type: ignore[arg-type]
        parent_file_id=parent_file_id,
        preview_json=parsed_preview_json,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )


@router.post("/chatkit/attachments/{attachment_id}/content")
async def complete_chatkit_attachment_upload(
    attachment_id: str,
    request: Request,
    token: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    store = DatabaseMemoryStore(
        db,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
    try:
        pending_upload = await store.resolve_pending_attachment_upload(
            attachment_id=attachment_id,
            token=token,
        )
    except HTTPException as exc:
        log_event(
            logger,
            logging.WARNING,
            "chat_attachment.finalize_token_rejected",
            summary=summarize_pairs_for_log(
                (("attachment", attachment_id), ("status", exc.status_code))
            ),
            detail=str(exc.detail),
        )
        raise

    file_bytes = await _extract_chat_attachment_upload_bytes(request)
    if not file_bytes:
        log_event(
            logger,
            logging.WARNING,
            "chat_attachment.finalize_missing_body",
            summary=summarize_pairs_for_log((("attachment", attachment_id),)),
        )
        raise HTTPException(status_code=400, detail="Attachment upload body is required.")

    if pending_upload.is_completed:
        display_attachment = await store.load_attachment(
            attachment_id,
            context=None,
            hydrate_preview=True,
        )
        return Response(
            content=display_attachment.model_dump_json(exclude_none=True),
            media_type="application/json",
        )
    if len(file_bytes) != pending_upload.declared_size:
        log_event(
            logger,
            logging.WARNING,
            "chat_attachment.finalize_size_mismatch",
            summary=summarize_pairs_for_log(
                (
                    ("attachment", attachment_id),
                    ("declared", pending_upload.declared_size),
                    ("received", len(file_bytes)),
                )
            ),
        )
        raise HTTPException(
            status_code=400,
            detail="Attachment upload size did not match the initialized file metadata.",
        )

    try:
        response = await StoredFileService(db).create_chat_attachment_upload(
            user_id=pending_upload.user_id,
            workspace_id=pending_upload.workspace_id,
            app_id=pending_upload.app_id,  # type: ignore[arg-type]
            file_name=pending_upload.attachment.name,
            mime_type=pending_upload.attachment.mime_type,
            file_bytes=file_bytes,
            attachment_id=attachment_id,
            scope="chat_attachment",
            thread_id=pending_upload.attachment.thread_id,
            create_attachment=True,
            public_base_url=resolve_public_base_url(str(request.base_url)),
        )
    except HTTPException as exc:
        log_event(
            logger,
            logging.WARNING,
            "chat_attachment.finalize_store_rejected",
            summary=summarize_pairs_for_log(
                (("attachment", attachment_id), ("status", exc.status_code))
            ),
            detail=str(exc.detail),
        )
        raise
    except Exception as exc:
        log_event(
            logger,
            logging.ERROR,
            "chat_attachment.finalize_store_failed",
            summary=summarize_pairs_for_log((("attachment", attachment_id),)),
            exc_info=exc,
        )
        raise
    if response.attachment is None:
        raise HTTPException(status_code=500, detail="Attachment upload did not finalize.")

    return Response(
        content=response.attachment.model_dump_json(exclude_none=True),
        media_type="application/json",
    )


@router.delete(
    "/chatkit/attachments/{attachment_id}",
    response_model=ChatAttachmentDeleteResponse,
)
async def delete_chatkit_attachment(
    attachment_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StoredFileService(db).delete_chat_attachment(
        user_id=user.id,
        attachment_id=attachment_id,
    )

@router.get(
    "/document-threads/{thread_id}/files",
    response_model=DocumentFileListResponse,
)
async def list_document_files(
    thread_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StoredFileService(db).list_document_files(
        user_id=user.id,
        thread_id=thread_id,
    )


@router.delete(
    "/document-threads/{thread_id}/files/{file_id}",
    response_model=DeleteDocumentFileResponse,
)
async def delete_document_file(
    thread_id: str,
    file_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await StoredFileService(db).delete_document_file(
        user_id=user.id,
        thread_id=thread_id,
        file_id=file_id,
    )


@router.get("/stored-files/{file_id}/content")
async def get_stored_file_content(
    file_id: str,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = StoredFileService(db)
    record = await service.get_stored_file(user_id=user.id, file_id=file_id)
    file_bytes = await service.load_file_bytes(record)
    return Response(
        content=file_bytes,
        media_type=record.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{record.name}"',
        },
    )


@router.get("/stored-files/{file_id}/preview")
async def get_stored_file_preview(
    file_id: str,
    token: str = Query(..., min_length=16),
    db: AsyncSession = Depends(get_db),
):
    service = StoredFileService(db)
    record = await service.get_preview_file(file_id=file_id, token=token)
    file_bytes = await service.load_file_bytes(record)
    return Response(
        content=file_bytes,
        media_type=record.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{record.name}"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.post(
    "/plodai/entities/search",
    response_model=PlodaiEntitySearchResponse,
)
async def search_plodai_entities(
    request: Request,
    payload: PlodaiEntitySearchRequest,
    user: AuthenticatedUser = Depends(require_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await PlodaiEntityService(db).search_entities(
        user_id=user.id,
        workspace_id=payload.workspace_id,
        app_id=payload.app_id,
        thread_id=payload.thread_id,
        query=payload.query,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
