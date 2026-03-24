import uuid

import pytest
from pydantic import ValidationError

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.workspace import (
    FarmItemPayload,
    FarmSetStateOperation,
    ReportSetTitleOperation,
    WorkspaceCreateRequest,
    WorkspaceItemCreateRequest,
    WorkspaceItemOperationRequest,
    WorkspaceReportPayload,
    WorkspaceUpdateRequest,
)
from backend.app.services.workspace_service import (
    WorkspaceRevisionConflictError,
    WorkspaceService,
)


def test_workspace_schemas_forbid_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        WorkspaceCreateRequest.model_validate(
            {
                "name": "Workspace",
                "app_id": "agriculture",
                "active_agent_id": "analysis-agent",
            }
        )


@pytest.mark.anyio
async def test_workspace_service_tracks_item_revisions(
    initialized_db: None,
) -> None:
    user_id = f"user_workspace_service_{uuid.uuid4().hex}"

    async with AsyncSessionLocal() as db:
        service = WorkspaceService(db)
        workspace = await service.create_workspace(
            user_id=user_id,
            app_id="documents",
            name="Workspace",
        )

        assert workspace.app_id == "documents"

        detail = await service.create_item(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            request=WorkspaceItemCreateRequest(
                id="report-1",
                kind="report.v1",
                created_by_agent_id="report-agent",
                payload=WorkspaceReportPayload(
                    version="v1",
                    report_id="report-1",
                    title="Board report",
                    created_at="2026-03-22T12:00:00Z",
                    updated_at="2026-03-22T12:00:00Z",
                    slides=[],
                ),
            ),
        )

        assert detail.current_revision == 1
        assert detail.title == "Board report"

        updated = await service.apply_item_operation(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            item_id=detail.id,
            request=WorkspaceItemOperationRequest(
                base_revision=1,
                created_by_agent_id="report-agent",
                operation=ReportSetTitleOperation(
                    op="report.set_title",
                    title="Board report revised",
                ),
            ),
        )

        assert updated.current_revision == 2
        assert updated.title == "Board report revised"
        assert updated.latest_op == "report.set_title"

        with pytest.raises(WorkspaceRevisionConflictError):
            await service.apply_item_operation(
                user_id=user_id,
                workspace_id=workspace.workspace_id,
                item_id=detail.id,
                request=WorkspaceItemOperationRequest(
                    base_revision=1,
                    created_by_agent_id="report-agent",
                    operation=ReportSetTitleOperation(
                        op="report.set_title",
                        title="Stale title",
                    ),
                ),
            )

        revisions = await service.list_item_revisions(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            item_id=detail.id,
        )

        assert [revision.revision for revision in revisions] == [1, 2]
        assert [revision.op for revision in revisions] == [
            "item.create",
            "report.set_title",
        ]


@pytest.mark.anyio
async def test_workspace_service_tracks_farm_items(
    initialized_db: None,
) -> None:
    user_id = f"user_workspace_farm_{uuid.uuid4().hex}"

    async with AsyncSessionLocal() as db:
        service = WorkspaceService(db)
        workspace = await service.create_workspace(
            user_id=user_id,
            app_id="agriculture",
            name="Farm workspace",
        )
        item_id = f"farm-overview-{uuid.uuid4().hex}"

        detail = await service.create_item(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            request=WorkspaceItemCreateRequest(
                id=item_id,
                kind="farm.v1",
                created_by_agent_id="agriculture-agent",
                payload=FarmItemPayload(
                    version="v1",
                    farm_name="North Orchard",
                    location="Block A",
                    crops=[
                        {
                            "id": "crop_1",
                            "name": "Honeycrisp apples",
                            "area": "12 acres",
                            "expected_yield": "480 bins",
                        }
                    ],
                    issues=[],
                    projects=[],
                    orders=[],
                    current_work=["Scout lower rows"],
                    notes="Initial setup.",
                ),
            ),
        )

        assert detail.title == "North Orchard"
        assert detail.summary.crop_count == 1

        updated = await service.apply_item_operation(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            item_id=detail.id,
            request=WorkspaceItemOperationRequest(
                base_revision=1,
                created_by_agent_id="agriculture-agent",
                operation=FarmSetStateOperation(
                    op="farm.set_state",
                    farm_name="North Orchard",
                    location="Block A",
                    crops=[
                        {
                            "id": "crop_1",
                            "name": "Honeycrisp apples",
                            "area": "12 acres",
                            "expected_yield": "480 bins",
                        },
                        {
                            "id": "crop_2",
                            "name": "Cherries",
                            "area": "4 acres",
                        },
                    ],
                    issues=[
                        {
                            "id": "issue_1",
                            "title": "Leaf curl in row 3",
                            "status": "watching",
                        }
                    ],
                    projects=[
                        {
                            "id": "project_1",
                            "title": "Irrigation refresh",
                            "status": "active",
                        }
                    ],
                    orders=[
                        {
                            "id": "order_1",
                            "title": "Sataras mix",
                            "status": "live",
                            "price_label": "9 EUR",
                            "items": [
                                {
                                    "id": "order_item_1",
                                    "label": "Onions",
                                    "quantity": "2 kg",
                                    "crop_id": "crop_1",
                                }
                            ],
                        }
                    ],
                    current_work=["Scout lower rows", "Check irrigation pressure"],
                    notes="Expanded farm record.",
                ),
            ),
        )

        assert updated.current_revision == 2
        assert updated.summary.crop_count == 2
        assert updated.summary.issue_count == 1
        assert updated.summary.project_count == 1
        assert updated.summary.order_count == 1


@pytest.mark.anyio
async def test_workspace_service_deletes_created_items(
    initialized_db: None,
) -> None:
    user_id = f"user_workspace_delete_{uuid.uuid4().hex}"

    async with AsyncSessionLocal() as db:
        service = WorkspaceService(db)
        workspace = await service.create_workspace(
            user_id=user_id,
            app_id="agriculture",
            name="Farm workspace",
        )
        item_id = f"farm-overview-{uuid.uuid4().hex}"

        detail = await service.create_item(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            request=WorkspaceItemCreateRequest(
                id=item_id,
                kind="farm.v1",
                created_by_agent_id="agriculture-agent",
                payload=FarmItemPayload(
                    version="v1",
                    farm_name="North Orchard",
                    location="Block A",
                    crops=[],
                    issues=[],
                    projects=[],
                    orders=[],
                    current_work=[],
                    notes=None,
                ),
            ),
        )

        await service.update_workspace(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            app_id="agriculture",
            update=WorkspaceUpdateRequest(
                selected_item_id=detail.id,
            ),
        )

        deleted = await service.delete_item(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            item_id=detail.id,
        )

        assert deleted.deleted is True

        state = await service.get_workspace_state(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            app_id="agriculture",
        )

        assert state.items == []
        assert state.selected_item_id is None
