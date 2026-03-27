from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.farm import FarmImage
from backend.app.schemas.farm import FarmArea, FarmCrop, FarmRecordPayload, FarmWorkItem
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
        areas_by_id = {area.id: area for area in record.areas}
        crops_by_id = {crop.id: crop for crop in record.crops}

        for crop in record.crops:
            linked_work_items = _linked_work_items_for_crop(record, crop.id)
            area_names = _area_names_for_ids(areas_by_id, crop.area_ids)
            work_item_terms: list[str | None] = []
            for work_item in linked_work_items:
                work_item_terms.extend(
                    [
                        work_item.title,
                        work_item.description,
                        work_item.kind,
                        work_item.status,
                        work_item.severity,
                        work_item.observed_at,
                        work_item.due_at,
                        work_item.recommended_follow_up,
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
                crop.status,
                crop.notes,
                *area_names,
                *work_item_terms,
            ):
                continue
            highest_severity = _highest_work_item_severity(linked_work_items)
            next_due_at = _next_work_item_due_at(linked_work_items)
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
                        "area_names": ", ".join(area_names),
                        "status": crop.status or "",
                        "notes": crop.notes or "",
                        "work_item_count": str(len(linked_work_items)),
                        "highest_severity": highest_severity or "",
                        "next_due_at": next_due_at or "",
                    },
                )
            )

        for work_item in record.work_items:
            related_crop_names = _crop_names_for_ids(crops_by_id, work_item.related_crop_ids)
            related_area_names = _area_names_for_ids(areas_by_id, work_item.related_area_ids)
            if not _matches_query(
                normalized_query,
                record.farm_name,
                record.description,
                record.location,
                work_item.title,
                work_item.kind,
                work_item.description,
                work_item.status,
                work_item.severity,
                work_item.observed_at,
                work_item.due_at,
                work_item.recommended_follow_up,
                *related_crop_names,
                *related_area_names,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-work-item:{farm_id}:{work_item.id}",
                    title=work_item.title,
                    icon="flag",
                    interactive=True,
                    group="Farm work items",
                    data={
                        "entity_type": "farm_work_item",
                        "farm_id": farm_id,
                        "farm_name": record.farm_name,
                        "item_id": work_item.id,
                        "kind": work_item.kind,
                        "status": work_item.status or "",
                        "severity": work_item.severity or "",
                        "observed_at": work_item.observed_at or "",
                        "due_at": work_item.due_at or "",
                        "description": work_item.description or "",
                        "recommended_follow_up": work_item.recommended_follow_up or "",
                        "related_crop_names": ", ".join(related_crop_names),
                        "related_area_names": ", ".join(related_area_names),
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


def _linked_work_items_for_crop(
    record: FarmRecordPayload,
    crop_id: str,
) -> list[FarmWorkItem]:
    return [
        work_item
        for work_item in record.work_items
        if crop_id in work_item.related_crop_ids
    ]


def _crop_names_for_ids(crops_by_id: dict[str, FarmCrop], crop_ids: list[str]) -> list[str]:
    names: list[str] = []
    for crop_id in crop_ids:
        crop = crops_by_id.get(crop_id)
        name = getattr(crop, "name", None)
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names


def _area_names_for_ids(areas_by_id: dict[str, FarmArea], area_ids: list[str]) -> list[str]:
    names: list[str] = []
    for area_id in area_ids:
        area = areas_by_id.get(area_id)
        name = getattr(area, "name", None)
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names


def _highest_work_item_severity(work_items: list[FarmWorkItem]) -> str | None:
    severity_order = {"low": 1, "medium": 2, "high": 3}
    highest = None
    highest_rank = -1
    for work_item in work_items:
        if work_item.severity is None:
            continue
        rank = severity_order.get(work_item.severity, 0)
        if rank > highest_rank:
            highest = work_item.severity
            highest_rank = rank
    return highest


def _next_work_item_due_at(work_items: list[FarmWorkItem]) -> str | None:
    due_dates = [
        work_item.due_at.strip()
        for work_item in work_items
        if work_item.due_at and work_item.due_at.strip()
    ]
    return sorted(due_dates)[0] if due_dates else None
