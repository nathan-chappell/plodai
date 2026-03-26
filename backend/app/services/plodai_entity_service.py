from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.farm import FarmImage
from backend.app.schemas.farm import FarmCrop, FarmRecordPayload
from backend.app.schemas.plodai_entities import (
    PlodaiComposerEntity,
    PlodaiEntitySearchResponse,
)
from backend.app.services.farm_image_service import FarmImageService
from backend.app.services.farm_service import FarmService


class PlodaiEntityService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        image_service: FarmImageService | None = None,
        farm_service: FarmService | None = None,
    ):
        self.db = db
        self.image_service = image_service or FarmImageService(db)
        self.farm_service = farm_service or FarmService(db)

    async def search_entities(
        self,
        *,
        user_id: str,
        farm_id: str,
        query: str,
        public_base_url: str | None = None,
    ) -> PlodaiEntitySearchResponse:
        await self.farm_service.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self.farm_service.get_record(user_id=user_id, farm_id=farm_id)
        normalized_query = query.strip().lower()
        entities = [
            *await self._search_images(
                user_id=user_id,
                farm_id=farm_id,
                normalized_query=normalized_query,
                public_base_url=public_base_url,
            ),
            *self._search_record(
                farm_id=farm_id,
                record=record,
                normalized_query=normalized_query,
            ),
        ]
        return PlodaiEntitySearchResponse(entities=entities[:24])

    async def _search_images(
        self,
        *,
        user_id: str,
        farm_id: str,
        normalized_query: str,
        public_base_url: str | None,
    ) -> list[PlodaiComposerEntity]:
        result = await self.db.execute(
            select(FarmImage)
            .where(
                FarmImage.user_id == user_id,
                FarmImage.farm_id == farm_id,
                FarmImage.status != "deleted",
            )
            .order_by(FarmImage.created_at.desc())
        )
        entities: list[PlodaiComposerEntity] = []
        for record in result.scalars().all():
            haystack = " ".join(
                [
                    record.name,
                    record.mime_type or "",
                    str(record.width),
                    str(record.height),
                ]
            ).lower()
            if normalized_query and normalized_query not in haystack:
                continue
            preview_url = self.image_service.build_public_preview_url(
                record,
                public_base_url=public_base_url,
            )
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-image:{record.id}",
                    title=record.name,
                    icon="images",
                    interactive=True,
                    group="Farm images",
                    data={
                        "entity_type": "farm_image",
                        "farm_id": farm_id,
                        "image_id": record.id,
                        "chat_id": record.chat_id or "",
                        "attachment_id": record.attachment_id or "",
                        "preview_url": preview_url,
                        "mime_type": record.mime_type or "",
                        "width": str(record.width),
                        "height": str(record.height),
                    },
                )
            )
        return entities

    def _search_record(
        self,
        *,
        farm_id: str,
        record: FarmRecordPayload,
        normalized_query: str,
    ) -> list[PlodaiComposerEntity]:
        entities: list[PlodaiComposerEntity] = []

        for crop in record.crops:
            issue_terms: list[str | None] = []
            for issue in crop.issues:
                issue_terms.extend(
                    [
                        issue.title,
                        issue.description,
                        issue.severity,
                        issue.deadline,
                        issue.recommended_follow_up,
                    ]
                )
            if not _matches_query(
                normalized_query,
                record.farm_name,
                record.description,
                record.location,
                crop.name,
                crop.type,
                _humanize_crop_type(crop.type),
                crop.quantity,
                crop.expected_yield,
                *issue_terms,
            ):
                continue
            highest_severity = _highest_crop_issue_severity(crop)
            next_deadline = _next_crop_issue_deadline(crop)
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-crop:{farm_id}:{crop.id}",
                    title=crop.name,
                    icon="notebook",
                    interactive=True,
                    group="Farm crops",
                    data={
                        "entity_type": "farm_crop",
                        "farm_id": farm_id,
                        "farm_name": record.farm_name,
                        "item_id": crop.id,
                        "type": _humanize_crop_type(crop.type) or "",
                        "quantity": crop.quantity or "",
                        "expected_yield": crop.expected_yield or "",
                        "issue_count": str(len(crop.issues)),
                        "highest_severity": highest_severity or "",
                        "next_deadline": next_deadline or "",
                    },
                )
            )

        for order in record.orders:
            order_item_terms: list[str | None] = []
            for order_item in order.items:
                order_item_terms.extend(
                    [
                        order_item.label,
                        order_item.quantity,
                        order_item.notes,
                    ]
                )
            if not _matches_query(
                normalized_query,
                record.farm_name,
                record.location,
                order.title,
                order.status,
                order.summary,
                order.price_label,
                order.notes,
                order.order_url,
                *order_item_terms,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-order:{farm_id}:{order.id}",
                    title=order.title,
                    icon="cart",
                    interactive=True,
                    group="Farm orders",
                    data={
                        "entity_type": "farm_order",
                        "farm_id": farm_id,
                        "farm_name": record.farm_name,
                        "item_id": order.id,
                        "status": order.status,
                        "price_label": order.price_label or "",
                        "summary": order.summary or "",
                        "notes": order.notes or "",
                        "order_url": order.order_url or "",
                    },
                )
            )

        return entities


def _matches_query(normalized_query: str, *values: str | None) -> bool:
    if not normalized_query:
        return True
    haystack = " ".join(value for value in values if value).lower()
    return normalized_query in haystack


def _humanize_crop_type(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.replace("_", " ").replace("-", " ").split())
    if not normalized:
        return None
    return normalized[0].upper() + normalized[1:]


def _highest_crop_issue_severity(crop: FarmCrop) -> str | None:
    severity_order = {"low": 1, "medium": 2, "high": 3}
    highest = None
    highest_rank = -1
    for issue in crop.issues:
        rank = severity_order.get(issue.severity, 0)
        if rank > highest_rank:
            highest = issue.severity
            highest_rank = rank
    return highest


def _next_crop_issue_deadline(crop: FarmCrop) -> str | None:
    deadlines = [
        issue.deadline.strip()
        for issue in crop.issues
        if issue.deadline and issue.deadline.strip()
    ]
    return sorted(deadlines)[0] if deadlines else None
