from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.advisory import AdvisoryImage
from backend.app.schemas.advisory import AdvisoryRecordPayload
from backend.app.schemas.plodai_entities import (
    PlodaiComposerEntity,
    PlodaiEntitySearchResponse,
)
from backend.app.services.advisory_image_service import AdvisoryImageService
from backend.app.services.advisory_service import AdvisoryService


class PlodaiEntityService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        image_service: AdvisoryImageService | None = None,
        advisory_service: AdvisoryService | None = None,
    ):
        self.db = db
        self.image_service = image_service or AdvisoryImageService(db)
        self.advisory_service = advisory_service or AdvisoryService(db)

    async def search_entities(
        self,
        *,
        user_id: str,
        case_id: str,
        query: str,
        public_base_url: str | None = None,
    ) -> PlodaiEntitySearchResponse:
        await self.advisory_service.require_case(user_id=user_id, case_id=case_id)
        record = await self.advisory_service.get_record(user_id=user_id, case_id=case_id)
        normalized_query = query.strip().lower()
        entities = [
            *await self._search_images(
                user_id=user_id,
                case_id=case_id,
                normalized_query=normalized_query,
                public_base_url=public_base_url,
            ),
            *self._search_record(
                case_id=case_id,
                record=record,
                normalized_query=normalized_query,
            ),
        ]
        return PlodaiEntitySearchResponse(entities=entities[:24])

    async def _search_images(
        self,
        *,
        user_id: str,
        case_id: str,
        normalized_query: str,
        public_base_url: str | None,
    ) -> list[PlodaiComposerEntity]:
        result = await self.db.execute(
            select(AdvisoryImage)
            .where(
                AdvisoryImage.user_id == user_id,
                AdvisoryImage.case_id == case_id,
                AdvisoryImage.status != "deleted",
            )
            .order_by(AdvisoryImage.created_at.desc())
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
                    id=f"advisory-image:{record.id}",
                    title=record.name,
                    icon="images",
                    interactive=True,
                    group="Evidence images",
                    data={
                        "entity_type": "advisory_image",
                        "case_id": case_id,
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
        case_id: str,
        record: AdvisoryRecordPayload,
        normalized_query: str,
    ) -> list[PlodaiComposerEntity]:
        entities: list[PlodaiComposerEntity] = []
        subjects_by_id = {subject.id: subject for subject in record.subjects}

        for subject in record.subjects:
            if not _matches_query(
                normalized_query,
                record.title,
                record.profile_description,
                record.default_location,
                subject.name,
                subject.kind,
                subject.type,
                subject.location,
                subject.description,
                subject.quantity,
                subject.status,
                subject.notes,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"advisory-subject:{case_id}:{subject.id}",
                    title=subject.name,
                    icon="notebook",
                    interactive=True,
                    group="Subjects",
                    data={
                        "entity_type": "advisory_subject",
                        "case_id": case_id,
                        "item_id": subject.id,
                        "kind": subject.kind,
                        "type": subject.type or "",
                        "location": subject.location or "",
                        "quantity": subject.quantity or "",
                        "status": subject.status or "",
                        "notes": subject.notes or "",
                    },
                )
            )

        for report in record.reports:
            subject_names = _subject_names_for_ids(subjects_by_id, report.subject_ids)
            if not _matches_query(
                normalized_query,
                record.title,
                report.title,
                report.category,
                report.description,
                report.status,
                report.severity,
                report.reported_at,
                report.observed_at,
                report.location,
                report.recommended_follow_up,
                *subject_names,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"advisory-report:{case_id}:{report.id}",
                    title=report.title,
                    icon="flag",
                    interactive=True,
                    group="Reports",
                    data={
                        "entity_type": "advisory_report",
                        "case_id": case_id,
                        "item_id": report.id,
                        "category": report.category,
                        "status": report.status or "",
                        "severity": report.severity or "",
                        "observed_at": report.observed_at or "",
                        "reported_at": report.reported_at or "",
                        "location": report.location or "",
                        "description": report.description or "",
                        "recommended_follow_up": report.recommended_follow_up or "",
                        "subject_names": ", ".join(subject_names),
                    },
                )
            )

        for query in record.queries:
            subject_names = _subject_names_for_ids(subjects_by_id, query.subject_ids)
            if not _matches_query(
                normalized_query,
                record.title,
                query.question,
                query.category,
                query.status,
                query.asked_at,
                query.answer_summary,
                query.notes,
                *query.source_urls,
                *subject_names,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"advisory-query:{case_id}:{query.id}",
                    title=query.question,
                    icon="search",
                    interactive=True,
                    group="Queries",
                    data={
                        "entity_type": "advisory_query",
                        "case_id": case_id,
                        "item_id": query.id,
                        "category": query.category,
                        "status": query.status,
                        "asked_at": query.asked_at or "",
                        "answer_summary": query.answer_summary or "",
                        "source_urls": ", ".join(query.source_urls),
                        "subject_names": ", ".join(subject_names),
                    },
                )
            )

        for measurement in record.measurements:
            subject_names = _subject_names_for_ids(subjects_by_id, measurement.subject_ids)
            if not _matches_query(
                normalized_query,
                record.title,
                measurement.label,
                measurement.value,
                measurement.unit,
                measurement.measured_at,
                measurement.method,
                measurement.location,
                measurement.notes,
                *subject_names,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"advisory-measurement:{case_id}:{measurement.id}",
                    title=measurement.label,
                    icon="ruler",
                    interactive=True,
                    group="Measurements",
                    data={
                        "entity_type": "advisory_measurement",
                        "case_id": case_id,
                        "item_id": measurement.id,
                        "value": measurement.value,
                        "unit": measurement.unit or "",
                        "measured_at": measurement.measured_at or "",
                        "method": measurement.method or "",
                        "location": measurement.location or "",
                        "subject_names": ", ".join(subject_names),
                    },
                )
            )

        for material in record.materials:
            if not _matches_query(
                normalized_query,
                record.title,
                material.name,
                material.purpose,
                material.category,
                material.status,
                material.supplier_name,
                material.supplier_url,
                material.notes,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"advisory-material:{case_id}:{material.id}",
                    title=material.name,
                    icon="cart",
                    interactive=True,
                    group="Materials",
                    data={
                        "entity_type": "advisory_material",
                        "case_id": case_id,
                        "item_id": material.id,
                        "purpose": material.purpose or "",
                        "category": material.category or "",
                        "status": material.status,
                        "supplier_name": material.supplier_name or "",
                        "supplier_url": material.supplier_url or "",
                        "notes": material.notes or "",
                    },
                )
            )

        return entities


def _matches_query(normalized_query: str, *values: str | None) -> bool:
    if not normalized_query:
        return True
    haystack = " ".join(value for value in values if value).lower()
    return normalized_query in haystack


def _subject_names_for_ids(subjects_by_id: dict[str, object], subject_ids: list[str]) -> list[str]:
    names: list[str] = []
    for subject_id in subject_ids:
        subject = subjects_by_id.get(subject_id)
        name = getattr(subject, "name", None)
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names
