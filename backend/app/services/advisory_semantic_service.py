from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import logging
import re
from typing import Protocol
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.models.advisory import AdvisoryImage, AdvisorySemanticSource
from backend.app.schemas.advisory import AdvisoryImageSummary, AdvisoryRecordPayload
from backend.app.schemas.advisory_semantic import (
    AdvisorySemanticItemType,
    AdvisorySemanticSearchHit,
    AdvisorySemanticSearchResponse,
)
from backend.app.services.advisory_service import AdvisoryService

logger = logging.getLogger(__name__)

RAG_USER_ID = "local-dev"


class RagIngestSource(Protocol):
    id: str


class RagIngestResult(Protocol):
    source: RagIngestSource


class RagSearchHit(Protocol):
    source_file_id: str
    score: float
    title: str
    summary: str
    text: str


class RagSearchResponse(Protocol):
    hits: list[RagSearchHit]


class RagLibrary(Protocol):
    async def ingest_text(
        self,
        text: str,
        *,
        filename: str = "source.txt",
        media_type: str = "text/plain",
        tag_ids: list[str] | None = None,
        user_guidance: str | None = None,
        folder_id: str | None = None,
        virtual_name: str | None = None,
        library_id: str | None = None,
        metadata: dict[str, object] | None = None,
        wait: bool = False,
        progress: object | None = None,
    ) -> RagIngestResult:
        ...

    async def search(
        self,
        query: str,
        *,
        library_id: str | None = None,
        selected_source_ids: list[str] | None = None,
        tag_ids: list[str] | None = None,
        max_results: int = 8,
    ) -> RagSearchResponse:
        ...


RagFactory = Callable[[], AbstractAsyncContextManager[RagLibrary]]


@dataclass(frozen=True, slots=True)
class SemanticItem:
    item_type: AdvisorySemanticItemType
    item_id: str
    title: str
    text: str
    content_hash: str


class AdvisorySemanticService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
        advisory_service: AdvisoryService | None = None,
        rag_factory: RagFactory | None = None,
    ) -> None:
        self.db = db
        self.settings = settings or get_settings()
        self.advisory_service = advisory_service or AdvisoryService(db)
        self._rag_factory = rag_factory

    async def search_reports_and_queries(
        self,
        *,
        user_id: str,
        case_id: str,
        query: str,
        max_results: int = 6,
    ) -> AdvisorySemanticSearchResponse:
        normalized_query = query.strip()
        if not normalized_query:
            return AdvisorySemanticSearchResponse(
                query=query,
                indexed_item_count=0,
                skipped_reason="Search query is empty.",
            )
        if not self.settings.semantic_search_enabled:
            return AdvisorySemanticSearchResponse(
                query=normalized_query,
                indexed_item_count=0,
                skipped_reason="Semantic search is disabled.",
            )

        record = await self.advisory_service.get_record(user_id=user_id, case_id=case_id)
        images = await self._list_described_images(user_id=user_id, case_id=case_id)
        items = build_semantic_items(record, advisory_images=images)
        if not items:
            await self._delete_removed_mappings(user_id=user_id, case_id=case_id, desired_items={})
            return AdvisorySemanticSearchResponse(query=normalized_query, indexed_item_count=0)

        try:
            async with self._open_rag() as rag:
                mappings = await self._sync_items(
                    rag=rag,
                    user_id=user_id,
                    case_id=case_id,
                    items=items,
                )
                source_ids = [mapping.source_id for mapping in mappings]
                search_response = await rag.search(
                    normalized_query,
                    selected_source_ids=source_ids,
                    max_results=max(1, min(max_results, 12)),
                )
        except Exception:
            logger.exception(
                "advisory_semantic_search_failed user_id=%s case_id=%s item_count=%s",
                user_id,
                case_id,
                len(items),
            )
            return AdvisorySemanticSearchResponse(
                query=normalized_query,
                indexed_item_count=len(items),
                skipped_reason="Semantic search backend is unavailable.",
            )

        mappings_by_source_id = {mapping.source_id: mapping for mapping in mappings}
        hits: list[AdvisorySemanticSearchHit] = []
        for hit in search_response.hits:
            mapping = mappings_by_source_id.get(hit.source_file_id)
            if mapping is None:
                continue
            hits.append(
                AdvisorySemanticSearchHit(
                    item_type=_item_type(mapping.item_type),
                    item_id=mapping.item_id,
                    title=mapping.title,
                    excerpt=_excerpt(hit.summary, hit.text),
                    score=float(hit.score),
                    source_id=mapping.source_id,
                )
            )
        return AdvisorySemanticSearchResponse(
            query=normalized_query,
            indexed_item_count=len(items),
            hits=hits,
        )

    async def _sync_items(
        self,
        *,
        rag: RagLibrary,
        user_id: str,
        case_id: str,
        items: list[SemanticItem],
    ) -> list[AdvisorySemanticSource]:
        desired_items = {(item.item_type, item.item_id): item for item in items}
        result = await self.db.execute(
            select(AdvisorySemanticSource).where(
                AdvisorySemanticSource.user_id == user_id,
                AdvisorySemanticSource.case_id == case_id,
                AdvisorySemanticSource.item_type.in_(["report", "query", "image"]),
            )
        )
        existing = list(result.scalars().all())
        existing_by_key = {(row.item_type, row.item_id): row for row in existing}

        await self._delete_removed_mappings(
            user_id=user_id,
            case_id=case_id,
            desired_items=desired_items,
            existing=existing,
        )

        synced: list[AdvisorySemanticSource] = []
        now = datetime.now(UTC)
        for item in items:
            key = (item.item_type, item.item_id)
            row = existing_by_key.get(key)
            if row is not None and row.content_hash == item.content_hash:
                synced.append(row)
                continue

            ingest = await rag.ingest_text(
                item.text,
                filename=_filename(case_id=case_id, item=item),
                virtual_name=_virtual_name(case_id=case_id, item=item),
                metadata={
                    "app": "plodai",
                    "plodai_user_id": user_id,
                    "case_id": case_id,
                    "item_type": item.item_type,
                    "item_id": item.item_id,
                },
                wait=True,
            )
            if row is None:
                row = AdvisorySemanticSource(
                    id=f"semantic_{uuid4().hex}",
                    user_id=user_id,
                    case_id=case_id,
                    item_type=item.item_type,
                    item_id=item.item_id,
                    source_id=ingest.source.id,
                    content_hash=item.content_hash,
                    title=item.title,
                )
                self.db.add(row)
            else:
                row.source_id = ingest.source.id
                row.content_hash = item.content_hash
                row.title = item.title
                row.updated_at = now
            synced.append(row)

        await self.db.commit()
        return synced

    async def _delete_removed_mappings(
        self,
        *,
        user_id: str,
        case_id: str,
        desired_items: dict[tuple[str, str], SemanticItem],
        existing: list[AdvisorySemanticSource] | None = None,
    ) -> None:
        if existing is None:
            result = await self.db.execute(
                select(AdvisorySemanticSource).where(
                    AdvisorySemanticSource.user_id == user_id,
                    AdvisorySemanticSource.case_id == case_id,
                    AdvisorySemanticSource.item_type.in_(["report", "query", "image"]),
                )
            )
            existing = list(result.scalars().all())
        for row in existing:
            if (row.item_type, row.item_id) not in desired_items:
                await self.db.delete(row)
        await self.db.flush()

    @asynccontextmanager
    async def _open_rag(self) -> AsyncIterator[RagLibrary]:
        if self._rag_factory is not None:
            async with self._rag_factory() as rag:
                yield rag
            return

        from openai_vectorstore2 import AppSettings, create_rag_library

        rag_settings = AppSettings(
            app_name="plodai-semantic-search",
            database_url=self.settings.semantic_vectorstore_database_url,
            database_schema_mode=self.settings.semantic_vectorstore_database_schema_mode,
            database_postgres_schema=self.settings.semantic_vectorstore_postgres_schema,
            storage_backend="local",
            local_storage_dir=self.settings.semantic_vectorstore_storage_dir,
            allow_local_dev_auth=True,
            billing_enabled=False,
            log_file_path=self.settings.semantic_vectorstore_log_file_path,
        )
        async with create_rag_library(
            rag_settings,
            clerk_user_id=RAG_USER_ID,
            origin_surface="plodai",
        ) as rag:
            yield rag

    async def _list_described_images(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> list[AdvisoryImageSummary]:
        result = await self.db.execute(
            select(AdvisoryImage)
            .where(
                AdvisoryImage.case_id == case_id,
                AdvisoryImage.user_id == user_id,
                AdvisoryImage.status != "deleted",
                AdvisoryImage.detailed_description.is_not(None),
            )
            .order_by(AdvisoryImage.created_at.desc())
        )
        images: list[AdvisoryImageSummary] = []
        for image in result.scalars().all():
            if not image.detailed_description or not image.detailed_description.strip():
                continue
            images.append(
                AdvisoryImageSummary(
                    id=image.id,
                    case_id=image.case_id,
                    chat_id=image.chat_id,
                    attachment_id=image.attachment_id,
                    source_kind=image.source_kind,  # type: ignore[arg-type]
                    name=image.name,
                    mime_type=image.mime_type,
                    byte_size=image.byte_size,
                    width=image.width,
                    height=image.height,
                    detailed_description=image.detailed_description,
                    location_label=image.location_label,
                    latitude=image.latitude,
                    longitude=image.longitude,
                    preview_url=None,
                    created_at=image.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                    updated_at=image.updated_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                )
            )
        return images


def build_semantic_items(
    record: AdvisoryRecordPayload,
    *,
    advisory_images: list[AdvisoryImageSummary] | None = None,
) -> list[SemanticItem]:
    subjects_by_id = {subject.id: subject for subject in record.subjects}
    items: list[SemanticItem] = []
    for report in record.reports:
        subject_names = [
            subjects_by_id[subject_id].name
            for subject_id in report.subject_ids
            if subject_id in subjects_by_id
        ]
        text = _lines(
            "PlodAI advisory report",
            f"Case: {record.title}",
            f"Profile: {record.profile_description}",
            f"Default location: {record.default_location}",
            f"Report title: {report.title}",
            f"Category: {report.category}",
            f"Status: {report.status}",
            f"Severity: {report.severity}",
            f"Observed at: {report.observed_at}",
            f"Reported at: {report.reported_at}",
            f"Location: {report.location}",
            f"Subjects: {', '.join(subject_names)}",
            f"Description: {report.description}",
            f"Recommended follow-up: {report.recommended_follow_up}",
        )
        items.append(_semantic_item("report", report.id, report.title, text))

    for inquiry in record.queries:
        subject_names = [
            subjects_by_id[subject_id].name
            for subject_id in inquiry.subject_ids
            if subject_id in subjects_by_id
        ]
        text = _lines(
            "PlodAI saved inquiry",
            f"Case: {record.title}",
            f"Profile: {record.profile_description}",
            f"Default location: {record.default_location}",
            f"Question: {inquiry.question}",
            f"Category: {inquiry.category}",
            f"Status: {inquiry.status}",
            f"Asked at: {inquiry.asked_at}",
            f"Subjects: {', '.join(subject_names)}",
            f"Answer summary: {inquiry.answer_summary}",
            f"Source URLs: {', '.join(inquiry.source_urls)}",
            f"Notes: {inquiry.notes}",
        )
        items.append(_semantic_item("query", inquiry.id, inquiry.question, text))
    for image in advisory_images or []:
        if not image.detailed_description or not image.detailed_description.strip():
            continue
        text = _lines(
            "PlodAI advisory image",
            f"Case: {record.title}",
            f"Profile: {record.profile_description}",
            f"Default location: {record.default_location}",
            f"Image name: {image.name}",
            f"Image ID: {image.id}",
            f"Location label: {image.location_label}",
            f"Latitude: {image.latitude}",
            f"Longitude: {image.longitude}",
            f"Detailed description: {image.detailed_description}",
        )
        items.append(_semantic_item("image", image.id, image.name, text))
    return items


def _semantic_item(
    item_type: AdvisorySemanticItemType,
    item_id: str,
    title: str,
    text: str,
) -> SemanticItem:
    return SemanticItem(
        item_type=item_type,
        item_id=item_id,
        title=title,
        text=text,
        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def _lines(*values: str) -> str:
    return "\n".join(value for value in values if not value.endswith(": None") and not value.endswith(": "))


def _filename(*, case_id: str, item: SemanticItem) -> str:
    return f"{_slug(case_id)}-{item.item_type}-{_slug(item.item_id)}.txt"


def _virtual_name(*, case_id: str, item: SemanticItem) -> str:
    return f"PlodAI {case_id} {item.item_type} {item.item_id}.txt"


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip())
    return cleaned.strip("-") or "item"


def _excerpt(summary: str, text: str) -> str:
    value = summary.strip() or text.strip()
    if len(value) <= 800:
        return value
    return f"{value[:797].rstrip()}..."


def _item_type(value: str) -> AdvisorySemanticItemType:
    if value == "report":
        return "report"
    if value == "image":
        return "image"
    return "query"
