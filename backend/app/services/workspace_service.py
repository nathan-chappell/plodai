from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.workspace import (
    Workspace,
    WorkspaceItem,
    WorkspaceItemRevision,
)
from backend.app.schemas.workspace import (
    ChartItemPayload,
    ChartItemSummaryData,
    ChartSetPreviewOperation,
    ChartSetSpecOperation,
    DatasetPreview,
    EmptyPreview,
    FarmItemPayload,
    FarmItemSummaryData,
    FarmSetStateOperation,
    ImagePreview,
    PdfPreview,
    PdfSplitItemPayload,
    PdfSplitItemSummaryData,
    PdfSplitSetResultOperation,
    ReportAppendSlideOperation,
    ReportItemSummaryData,
    ReportRemoveSlideOperation,
    ReportReplaceSlideOperation,
    ReportSetTitleOperation,
    WorkspaceCreatedItemDetail,
    WorkspaceAppId,
    WorkspaceCreatedItemKind,
    WorkspaceCreatedItemSummary,
    WorkspaceCreatedItemSummaryData,
    WorkspaceItemCreateRequest,
    WorkspaceItemDeleteResponse,
    WorkspaceItemDetail,
    WorkspaceItemOperation,
    WorkspaceItemOperationRequest,
    WorkspaceItemPayload,
    WorkspaceItemRevisionEntry,
    WorkspaceItemSummary,
    WorkspaceListItem,
    WorkspaceState,
    WorkspaceUpdateRequest,
    WorkspaceUploadCreateRequest,
    WorkspaceUploadDeleteResponse,
    WorkspaceUploadItemSummary,
)


@dataclass(kw_only=True)
class CreatedItemMutationResult:
    title: str
    payload: WorkspaceItemPayload
    summary: WorkspaceCreatedItemSummaryData


class WorkspaceRevisionConflictError(Exception):
    pass


class WorkspaceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_workspaces(
        self,
        *,
        user_id: str,
        app_id: WorkspaceAppId,
    ) -> list[WorkspaceListItem]:
        result = await self.db.execute(
            select(Workspace)
            .where(Workspace.user_id == user_id, Workspace.app_id == app_id)
            .options(selectinload(Workspace.items))
            .order_by(Workspace.updated_at.desc(), Workspace.created_at.desc())
        )
        workspaces = result.scalars().unique().all()
        return [self._serialize_workspace_list_item(workspace) for workspace in workspaces]

    async def create_workspace(
        self,
        *,
        user_id: str,
        app_id: WorkspaceAppId,
        name: str,
        active_chat_id: str | None = None,
        selected_item_id: str | None = None,
        current_report_item_id: str | None = None,
    ) -> WorkspaceState:
        workspace = Workspace(
            id=f"workspace_{uuid4()}",
            user_id=user_id,
            app_id=app_id,
            name=name.strip(),
            active_chat_id=active_chat_id,
            selected_item_id=selected_item_id,
            current_report_item_id=current_report_item_id,
        )
        self.db.add(workspace)
        await self.db.commit()
        hydrated_workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace.id,
        )
        return self._serialize_workspace_state(hydrated_workspace)

    async def get_workspace_state(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: WorkspaceAppId,
    ) -> WorkspaceState:
        workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id=app_id,
        )
        return self._serialize_workspace_state(workspace)

    async def update_workspace(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: WorkspaceAppId,
        update: WorkspaceUpdateRequest,
    ) -> WorkspaceState:
        workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id=app_id,
        )
        if "name" in update.model_fields_set and update.name is not None:
            workspace.name = update.name.strip()
        if "active_chat_id" in update.model_fields_set:
            workspace.active_chat_id = update.active_chat_id
        if "selected_item_id" in update.model_fields_set:
            workspace.selected_item_id = update.selected_item_id
        if "current_report_item_id" in update.model_fields_set:
            workspace.current_report_item_id = update.current_report_item_id
        await self.db.commit()
        hydrated_workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace.id,
            app_id=app_id,
        )
        return self._serialize_workspace_state(hydrated_workspace)

    async def create_upload(
        self,
        *,
        user_id: str,
        workspace_id: str,
        request: WorkspaceUploadCreateRequest,
    ) -> WorkspaceUploadItemSummary:
        workspace = await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = next((candidate for candidate in workspace.items if candidate.id == request.id), None)
        if item is None:
            item = WorkspaceItem(
                id=request.id,
                workspace_id=workspace.id,
                item_origin="upload",
                kind=request.kind,
                name=request.name,
                title=None,
                content_key=request.content_key,
                extension=request.extension,
                mime_type=request.mime_type,
                byte_size=request.byte_size,
                local_status=request.local_status,
                source_item_id=request.source_item_id,
                preview_json=request.preview.model_dump(),
                created_by_user_id=user_id,
            )
            self.db.add(item)
        else:
            item.item_origin = "upload"
            item.kind = request.kind
            item.name = request.name
            item.title = None
            item.content_key = request.content_key
            item.extension = request.extension
            item.mime_type = request.mime_type
            item.byte_size = request.byte_size
            item.local_status = request.local_status
            item.source_item_id = request.source_item_id
            item.preview_json = request.preview.model_dump()
            item.created_by_user_id = user_id

        await self.db.commit()
        await self.db.refresh(item)
        return self._serialize_upload_item(item)

    async def delete_upload(
        self,
        *,
        user_id: str,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceUploadDeleteResponse:
        workspace = await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = next((candidate for candidate in workspace.items if candidate.id == item_id), None)
        if item is None or item.item_origin != "upload":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace upload not found.",
            )
        workspace.items.remove(item)
        await self.db.delete(item)
        if workspace.selected_item_id == item_id:
            workspace.selected_item_id = None
        if workspace.current_report_item_id == item_id:
            workspace.current_report_item_id = None
        await self.db.commit()
        return WorkspaceUploadDeleteResponse(
            workspace_id=workspace_id,
            item_id=item_id,
            deleted=True,
        )

    async def create_item(
        self,
        *,
        user_id: str,
        workspace_id: str,
        request: WorkspaceItemCreateRequest,
    ) -> WorkspaceCreatedItemDetail:
        workspace = await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        existing = await self._get_item_or_none(
            workspace_id=workspace_id,
            item_id=request.id,
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workspace item already exists.",
            )
        mutation = self._derive_created_item_state(
            kind=request.kind,
            payload=request.payload,
        )
        item = WorkspaceItem(
            id=request.id,
            workspace_id=workspace.id,
            item_origin="created",
            kind=request.kind,
            title=mutation.title,
            schema_version="v1",
            current_revision=1,
            created_by_user_id=user_id,
            created_by_agent_id=request.created_by_agent_id,
        )
        self.db.add(item)
        revision = WorkspaceItemRevision(
            item_id=item.id,
            revision=1,
            op="item.create",
            payload_json=request.payload.model_dump(),
            summary_json=mutation.summary.model_dump(),
            created_by_user_id=user_id,
            created_by_agent_id=request.created_by_agent_id,
        )
        item.revisions.append(revision)
        self.db.add(revision)
        if request.kind == "report.v1":
            workspace.current_report_item_id = request.id
        await self.db.commit()
        return await self.get_item_detail(
            user_id=user_id,
            workspace_id=workspace_id,
            item_id=request.id,
        )

    async def delete_item(
        self,
        *,
        user_id: str,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceItemDeleteResponse:
        workspace = await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = next((candidate for candidate in workspace.items if candidate.id == item_id), None)
        if item is None or item.item_origin != "created":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace item not found.",
            )
        workspace.items.remove(item)
        await self.db.delete(item)
        if workspace.selected_item_id == item_id:
            workspace.selected_item_id = None
        if workspace.current_report_item_id == item_id:
            workspace.current_report_item_id = None
        await self.db.commit()
        return WorkspaceItemDeleteResponse(
            workspace_id=workspace_id,
            item_id=item_id,
            deleted=True,
        )

    async def get_item_detail(
        self,
        *,
        user_id: str,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceItemDetail:
        await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = await self._get_item(
            workspace_id=workspace_id,
            item_id=item_id,
        )
        if item.item_origin == "upload":
            return self._serialize_upload_item(item)
        return self._serialize_created_item_detail(item)

    async def list_item_revisions(
        self,
        *,
        user_id: str,
        workspace_id: str,
        item_id: str,
    ) -> list[WorkspaceItemRevisionEntry]:
        await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = await self._get_created_item(
            workspace_id=workspace_id,
            item_id=item_id,
        )
        return [self._serialize_item_revision(item, revision) for revision in item.revisions]

    async def apply_item_operation(
        self,
        *,
        user_id: str,
        workspace_id: str,
        item_id: str,
        request: WorkspaceItemOperationRequest,
    ) -> WorkspaceCreatedItemDetail:
        await self._get_workspace(user_id=user_id, workspace_id=workspace_id)
        item = await self._get_created_item(
            workspace_id=workspace_id,
            item_id=item_id,
        )
        current_revision = item.current_revision or 0
        if current_revision != request.base_revision:
            raise WorkspaceRevisionConflictError(
                f"Item revision conflict. Expected {current_revision}, got {request.base_revision}."
            )

        latest_revision = item.revisions[-1]
        current_payload = self._payload_model_for_kind(item.kind).model_validate(
            latest_revision.payload_json
        )
        next_payload = self._apply_operation(
            kind=item.kind,
            payload=current_payload,
            operation=request.operation,
        )
        mutation = self._derive_created_item_state(
            kind=item.kind,
            payload=next_payload,
        )
        next_revision = current_revision + 1
        item.current_revision = next_revision
        item.title = mutation.title
        revision = WorkspaceItemRevision(
            item_id=item.id,
            revision=next_revision,
            op=request.operation.op,
            payload_json=next_payload.model_dump(),
            summary_json=mutation.summary.model_dump(),
            created_by_user_id=user_id,
            created_by_agent_id=request.created_by_agent_id,
        )
        item.revisions.append(revision)
        self.db.add(revision)
        await self.db.commit()
        return await self.get_item_detail(
            user_id=user_id,
            workspace_id=workspace_id,
            item_id=item_id,
        )

    async def _get_workspace(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: WorkspaceAppId | None = None,
    ) -> Workspace:
        result = await self.db.execute(self._workspace_query().where(Workspace.id == workspace_id))
        workspace = result.scalars().unique().first()
        if (
            workspace is None
            or workspace.user_id != user_id
            or (app_id is not None and workspace.app_id != app_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace not found.",
            )
        return workspace

    async def _get_item_or_none(
        self,
        *,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceItem | None:
        result = await self.db.execute(
            self._item_query().where(
                WorkspaceItem.workspace_id == workspace_id,
                WorkspaceItem.id == item_id,
            )
        )
        return result.scalars().unique().first()

    async def _get_item(
        self,
        *,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceItem:
        item = await self._get_item_or_none(
            workspace_id=workspace_id,
            item_id=item_id,
        )
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace item not found.",
            )
        return item

    async def _get_created_item(
        self,
        *,
        workspace_id: str,
        item_id: str,
    ) -> WorkspaceItem:
        item = await self._get_item(
            workspace_id=workspace_id,
            item_id=item_id,
        )
        if item.item_origin != "created":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workspace item is not revision-backed.",
            )
        return item

    def _workspace_query(self) -> Select[tuple[Workspace]]:
        return select(Workspace).options(
            selectinload(Workspace.items).selectinload(WorkspaceItem.revisions),
        )

    def _item_query(self) -> Select[tuple[WorkspaceItem]]:
        return select(WorkspaceItem).options(
            selectinload(WorkspaceItem.revisions),
        )

    def _serialize_workspace_list_item(self, workspace: Workspace) -> WorkspaceListItem:
        return WorkspaceListItem(
            id=workspace.id,
            app_id=workspace.app_id,
            name=workspace.name,
            active_chat_id=workspace.active_chat_id,
            selected_item_id=workspace.selected_item_id,
            current_report_item_id=workspace.current_report_item_id,
            item_count=len(workspace.items),
            created_at=self._iso(workspace.created_at),
            updated_at=self._iso(workspace.updated_at),
        )

    def _serialize_workspace_state(self, workspace: Workspace) -> WorkspaceState:
        items = sorted(
            workspace.items,
            key=lambda item: (
                item.updated_at,
                item.created_at,
                item.id,
            ),
            reverse=True,
        )
        return WorkspaceState(
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            app_id=workspace.app_id,
            active_chat_id=workspace.active_chat_id,
            selected_item_id=workspace.selected_item_id,
            current_report_item_id=workspace.current_report_item_id,
            items=[self._serialize_item_summary(item) for item in items],
        )

    def _serialize_item_summary(self, item: WorkspaceItem) -> WorkspaceItemSummary:
        if item.item_origin == "upload":
            return self._serialize_upload_item(item)
        return self._serialize_created_item_summary(item)

    def _serialize_upload_item(self, item: WorkspaceItem) -> WorkspaceUploadItemSummary:
        preview = self._preview_model_for_kind(item.kind).model_validate(item.preview_json or {})
        return WorkspaceUploadItemSummary(
            id=item.id,
            workspace_id=item.workspace_id,
            name=item.name or item.id,
            kind=item.kind,
            extension=item.extension,
            mime_type=item.mime_type,
            byte_size=item.byte_size,
            content_key=item.content_key or "",
            local_status=item.local_status or "missing",
            preview=preview,
            source_item_id=item.source_item_id,
            created_at=self._iso(item.created_at),
            updated_at=self._iso(item.updated_at),
        )

    def _serialize_created_item_summary(
        self,
        item: WorkspaceItem,
    ) -> WorkspaceCreatedItemSummary:
        current_revision = item.revisions[-1]
        summary = self._summary_model_for_kind(item.kind).model_validate(
            current_revision.summary_json
        )
        return WorkspaceCreatedItemSummary(
            id=item.id,
            workspace_id=item.workspace_id,
            kind=item.kind,
            schema_version="v1",
            title=item.title or item.id,
            current_revision=item.current_revision or 1,
            created_by_user_id=item.created_by_user_id,
            created_by_agent_id=item.created_by_agent_id,
            last_edited_by_agent_id=current_revision.created_by_agent_id,
            summary=summary,
            latest_op=current_revision.op,
            created_at=self._iso(item.created_at),
            updated_at=self._iso(item.updated_at),
        )

    def _serialize_created_item_detail(
        self,
        item: WorkspaceItem,
    ) -> WorkspaceCreatedItemDetail:
        current_revision = item.revisions[-1]
        summary = self._summary_model_for_kind(item.kind).model_validate(
            current_revision.summary_json
        )
        payload = self._payload_model_for_kind(item.kind).model_validate(
            current_revision.payload_json
        )
        return WorkspaceCreatedItemDetail(
            id=item.id,
            workspace_id=item.workspace_id,
            kind=item.kind,
            schema_version="v1",
            title=item.title or item.id,
            current_revision=item.current_revision or 1,
            created_by_user_id=item.created_by_user_id,
            created_by_agent_id=item.created_by_agent_id,
            last_edited_by_agent_id=current_revision.created_by_agent_id,
            summary=summary,
            latest_op=current_revision.op,
            payload=payload,
            created_at=self._iso(item.created_at),
            updated_at=self._iso(item.updated_at),
        )

    def _serialize_item_revision(
        self,
        item: WorkspaceItem,
        revision: WorkspaceItemRevision,
    ) -> WorkspaceItemRevisionEntry:
        return WorkspaceItemRevisionEntry(
            item_id=item.id,
            revision=revision.revision,
            op=revision.op,
            payload=self._payload_model_for_kind(item.kind).model_validate(
                revision.payload_json
            ),
            summary=self._summary_model_for_kind(item.kind).model_validate(
                revision.summary_json
            ),
            created_by_user_id=revision.created_by_user_id,
            created_by_agent_id=revision.created_by_agent_id,
            created_at=self._iso(revision.created_at),
        )

    def _payload_model_for_kind(
        self,
        kind: WorkspaceCreatedItemKind,
    ) -> type[WorkspaceItemPayload]:
        if kind == "report.v1":
            from backend.app.schemas.workspace import WorkspaceReportPayload

            return WorkspaceReportPayload
        if kind == "chart.v1":
            return ChartItemPayload
        if kind == "farm.v1":
            return FarmItemPayload
        return PdfSplitItemPayload

    def _summary_model_for_kind(
        self,
        kind: WorkspaceCreatedItemKind,
    ) -> type[WorkspaceCreatedItemSummaryData]:
        if kind == "report.v1":
            return ReportItemSummaryData
        if kind == "chart.v1":
            return ChartItemSummaryData
        if kind == "farm.v1":
            return FarmItemSummaryData
        return PdfSplitItemSummaryData

    def _preview_model_for_kind(self, kind: str):
        if kind in {"csv", "json"}:
            return DatasetPreview
        if kind == "pdf":
            return PdfPreview
        if kind == "image":
            return ImagePreview
        return EmptyPreview

    def _derive_created_item_state(
        self,
        *,
        kind: WorkspaceCreatedItemKind,
        payload: WorkspaceItemPayload,
    ) -> CreatedItemMutationResult:
        if kind == "report.v1":
            assert payload.__class__.__name__ == "WorkspaceReportPayload"
            return CreatedItemMutationResult(
                title=payload.title,
                payload=payload,
                summary=ReportItemSummaryData(slide_count=len(payload.slides)),
            )
        if kind == "chart.v1":
            chart_payload = ChartItemPayload.model_validate(payload)
            return CreatedItemMutationResult(
                title=chart_payload.title,
                payload=chart_payload,
                summary=ChartItemSummaryData(
                    source_file_id=chart_payload.source_file_id,
                    chart_plan_id=chart_payload.chart_plan_id,
                    projection_file_id=chart_payload.projection_file_id,
                ),
            )
        if kind == "farm.v1":
            farm_payload = FarmItemPayload.model_validate(payload)
            return CreatedItemMutationResult(
                title=farm_payload.farm_name,
                payload=farm_payload,
                summary=FarmItemSummaryData(
                    crop_count=len(farm_payload.crops),
                    order_count=len(farm_payload.orders),
                ),
            )
        pdf_payload = PdfSplitItemPayload.model_validate(payload)
        return CreatedItemMutationResult(
            title=pdf_payload.title,
            payload=pdf_payload,
            summary=PdfSplitItemSummaryData(
                source_file_id=pdf_payload.source_file_id,
                entry_count=len(pdf_payload.entries),
                archive_file_id=pdf_payload.archive_file_id,
                index_file_id=pdf_payload.index_file_id,
            ),
        )

    def _apply_operation(
        self,
        *,
        kind: WorkspaceCreatedItemKind,
        payload: WorkspaceItemPayload,
        operation: WorkspaceItemOperation,
    ) -> WorkspaceItemPayload:
        if kind == "report.v1":
            return self._apply_report_operation(payload, operation)
        if kind == "chart.v1":
            return self._apply_chart_operation(payload, operation)
        if kind == "farm.v1":
            return self._apply_farm_operation(payload, operation)
        return self._apply_pdf_split_operation(payload, operation)

    def _apply_report_operation(
        self,
        payload: WorkspaceItemPayload,
        operation: WorkspaceItemOperation,
    ) -> WorkspaceItemPayload:
        from backend.app.schemas.workspace import WorkspaceReportPayload

        report = WorkspaceReportPayload.model_validate(payload)
        if isinstance(operation, ReportSetTitleOperation):
            return report.model_copy(
                update={
                    "title": operation.title,
                    "updated_at": self._now_iso(),
                }
            )
        if isinstance(operation, ReportAppendSlideOperation):
            return report.model_copy(
                update={
                    "slides": [*report.slides, operation.slide],
                    "updated_at": self._now_iso(),
                }
            )
        if isinstance(operation, ReportReplaceSlideOperation):
            replaced = False
            next_slides = []
            for slide in report.slides:
                if slide.id == operation.slide_id:
                    next_slides.append(operation.slide)
                    replaced = True
                else:
                    next_slides.append(slide)
            if not replaced:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Report slide not found.",
                )
            return report.model_copy(
                update={
                    "slides": next_slides,
                    "updated_at": self._now_iso(),
                }
            )
        if isinstance(operation, ReportRemoveSlideOperation):
            next_slides = [slide for slide in report.slides if slide.id != operation.slide_id]
            if len(next_slides) == len(report.slides):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Report slide not found.",
                )
            return report.model_copy(
                update={
                    "slides": next_slides,
                    "updated_at": self._now_iso(),
                }
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid report operation.",
        )

    def _apply_chart_operation(
        self,
        payload: WorkspaceItemPayload,
        operation: WorkspaceItemOperation,
    ) -> WorkspaceItemPayload:
        chart_payload = ChartItemPayload.model_validate(payload)
        if isinstance(operation, ChartSetSpecOperation):
            return chart_payload.model_copy(
                update={
                    "source_file_id": operation.source_file_id,
                    "chart_plan_id": operation.chart_plan_id,
                    "title": operation.title,
                    "chart": operation.chart,
                    "linked_report_id": operation.linked_report_id,
                    "projection_file_id": operation.projection_file_id,
                }
            )
        if isinstance(operation, ChartSetPreviewOperation):
            return chart_payload.model_copy(
                update={
                    "image_data_url": operation.image_data_url,
                    "projection_file_id": operation.projection_file_id
                    if operation.projection_file_id is not None
                    else chart_payload.projection_file_id,
                }
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chart operation.",
        )

    def _apply_pdf_split_operation(
        self,
        payload: WorkspaceItemPayload,
        operation: WorkspaceItemOperation,
    ) -> WorkspaceItemPayload:
        pdf_payload = PdfSplitItemPayload.model_validate(payload)
        if isinstance(operation, PdfSplitSetResultOperation):
            return pdf_payload.model_copy(
                update={
                    "title": operation.title,
                    "source_file_id": operation.source_file_id,
                    "entries": operation.entries,
                    "archive_file_id": operation.archive_file_id,
                    "index_file_id": operation.index_file_id,
                    "markdown": operation.markdown,
                }
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pdf split operation.",
        )

    def _apply_farm_operation(
        self,
        payload: WorkspaceItemPayload,
        operation: WorkspaceItemOperation,
    ) -> WorkspaceItemPayload:
        farm_payload = FarmItemPayload.model_validate(payload)
        if isinstance(operation, FarmSetStateOperation):
            return farm_payload.model_copy(
                update={
                    "farm_name": operation.farm_name,
                    "location": operation.location,
                    "crops": operation.crops,
                    "orders": (
                        operation.orders
                        if operation.orders is not None
                        else farm_payload.orders
                    ),
                    "notes": operation.notes,
                }
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid farm operation.",
        )

    def _iso(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

    def _now_iso(self) -> str:
        return self._iso(datetime.now(UTC))
