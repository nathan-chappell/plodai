import uuid

import pytest
from fastapi import HTTPException

from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.workspace import FarmItemPayload, WorkspaceItemCreateRequest
from backend.app.services.public_farm_order_service import PublicFarmOrderService
from backend.app.services.workspace_service import WorkspaceService


@pytest.mark.anyio
async def test_public_farm_order_service_returns_live_order(
    initialized_db: None,
) -> None:
    user_id = f"user_public_order_{uuid.uuid4().hex}"

    async with AsyncSessionLocal() as db:
        workspace_service = WorkspaceService(db)
        workspace = await workspace_service.create_workspace(
            user_id=user_id,
            app_id="agriculture",
            name="North Orchard",
        )

        await workspace_service.create_item(
            user_id=user_id,
            workspace_id=workspace.workspace_id,
            request=WorkspaceItemCreateRequest(
                id=f"farm-overview-{uuid.uuid4().hex}",
                kind="farm.v1",
                created_by_agent_id="agriculture-agent",
                payload=FarmItemPayload(
                    version="v1",
                    farm_name="North Orchard",
                    location="Block A",
                    crops=[],
                    issues=[],
                    projects=[],
                    orders=[
                        {
                            "id": "order_live",
                            "title": "Sataras mix",
                            "status": "live",
                            "price_label": "9 EUR",
                            "items": [
                                {
                                    "id": "order_item_1",
                                    "label": "Tomatoes",
                                    "quantity": "2 kg",
                                }
                            ],
                        },
                        {
                            "id": "order_draft",
                            "title": "Draft mix",
                            "status": "draft",
                            "items": [],
                        },
                    ],
                    current_work=[],
                    notes=None,
                ),
            ),
        )

        response = await PublicFarmOrderService(db).get_public_order(
            workspace_id=workspace.workspace_id,
            order_id="order_live",
            public_base_url="http://localhost",
        )

        assert response.workspace_id == workspace.workspace_id
        assert response.farm_name == "North Orchard"
        assert response.order.title == "Sataras mix"
        assert response.order.price_label == "9 EUR"

        with pytest.raises(HTTPException):
            await PublicFarmOrderService(db).get_public_order(
                workspace_id=workspace.workspace_id,
                order_id="order_draft",
                public_base_url="http://localhost",
            )
