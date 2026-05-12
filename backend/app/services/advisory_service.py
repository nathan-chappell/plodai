from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import get_settings
from backend.app.models.advisory import (
    AdvisoryCase,
    AdvisoryChat,
    AdvisoryChatAttachment,
    AdvisoryChatEntry,
    AdvisoryImage,
    AdvisoryRecord,
)
from backend.app.schemas.advisory import (
    AdvisoryCaseCreateRequest,
    AdvisoryCaseDetail,
    AdvisoryRecordPayload,
    AdvisoryCaseSummary,
    AdvisoryCaseUpdateRequest,
)
from backend.app.services.bucket_storage import RailwayBucketService


class AdvisoryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_cases(
        self,
        *,
        user_id: str,
    ) -> list[AdvisoryCaseSummary]:
        result = await self.db.execute(
            select(AdvisoryCase)
            .where(AdvisoryCase.user_id == user_id)
            .order_by(AdvisoryCase.updated_at.desc(), AdvisoryCase.created_at.desc())
        )
        cases = list(result.scalars().all())
        if not cases:
            cases = [await self._create_case_row(user_id=user_id, title="")]
        return [await self._serialize_case_summary(case) for case in cases]

    async def create_case(
        self,
        *,
        user_id: str,
        request: AdvisoryCaseCreateRequest,
    ) -> AdvisoryCaseDetail:
        case = await self._create_case_row(user_id=user_id, title=request.title)
        return await self.get_case(user_id=user_id, case_id=case.id)

    async def get_case(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> AdvisoryCaseDetail:
        case = await self.require_case(user_id=user_id, case_id=case_id)
        record = await self._get_record_row(case_id)
        summary = await self._serialize_case_summary(case)
        record_payload = AdvisoryRecordPayload.model_validate(record.payload_json)
        return AdvisoryCaseDetail(
            **summary.model_dump(),
            default_location=record_payload.default_location,
            profile_description=record_payload.profile_description,
        )

    async def update_case(
        self,
        *,
        user_id: str,
        case_id: str,
        request: AdvisoryCaseUpdateRequest,
    ) -> AdvisoryCaseDetail:
        case = await self.require_case(user_id=user_id, case_id=case_id)
        record = await self._get_record_row(case_id)
        payload = AdvisoryRecordPayload.model_validate(record.payload_json)
        if "title" in request.model_fields_set and request.title is not None:
            cleaned_title = request.title.strip()
            if not cleaned_title:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Advisory case title cannot be blank.",
                )
            case.title = cleaned_title
            record.payload_json = payload.model_copy(
                update={"title": cleaned_title}
            ).model_dump(mode="json")
        await self.db.commit()
        return await self.get_case(user_id=user_id, case_id=case_id)

    async def get_record(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> AdvisoryRecordPayload:
        await self.require_case(user_id=user_id, case_id=case_id)
        record = await self._get_record_row(case_id)
        return AdvisoryRecordPayload.model_validate(record.payload_json)

    async def save_record(
        self,
        *,
        user_id: str,
        case_id: str,
        record: AdvisoryRecordPayload,
    ) -> AdvisoryRecordPayload:
        case = await self.require_case(user_id=user_id, case_id=case_id)
        record_row = await self._get_record_row(case_id)
        cleaned_title = record.title.strip()
        if not cleaned_title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Advisory case title cannot be blank.",
            )
        case.title = cleaned_title
        record_row.payload_json = record.model_dump(mode="json")
        case.updated_at = datetime.now(UTC)
        record_row.updated_at = datetime.now(UTC)
        await self.db.commit()
        return record

    async def delete_case(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> None:
        case = await self.require_case(user_id=user_id, case_id=case_id)
        record = await self._get_record_row(case_id)
        bucket_service = RailwayBucketService(get_settings())

        image_result = await self.db.execute(
            select(AdvisoryImage).where(AdvisoryImage.case_id == case_id)
        )
        images = list(image_result.scalars().all())
        chat_result = await self.db.execute(
            select(AdvisoryChat).where(AdvisoryChat.case_id == case_id)
        )
        chats = list(chat_result.scalars().all())
        chat_ids = {chat.id for chat in chats}
        image_attachment_ids = {
            image.attachment_id.strip()
            for image in images
            if image.attachment_id and image.attachment_id.strip()
        }
        storage_keys = {
            image.storage_key.strip()
            for image in images
            if image.storage_key and image.storage_key.strip()
        }

        attachment_result = await self.db.execute(select(AdvisoryChatAttachment))
        attachments_to_delete: list[AdvisoryChatAttachment] = []
        for attachment in attachment_result.scalars().all():
            payload = attachment.payload if isinstance(attachment.payload, dict) else {}
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            thread_id = payload.get("thread_id")
            matches_case = (
                metadata.get("case_id") == case_id
                or attachment.id in image_attachment_ids
                or (isinstance(thread_id, str) and thread_id in chat_ids)
            )
            if not matches_case:
                continue
            attachments_to_delete.append(attachment)
            storage_key = metadata.get("storage_key")
            if isinstance(storage_key, str) and storage_key.strip():
                storage_keys.add(storage_key.strip())

        for storage_key in storage_keys:
            try:
                await bucket_service.delete_object(key=storage_key)
            except Exception:
                pass

        for attachment in attachments_to_delete:
            await self.db.delete(attachment)

        if chat_ids:
            await self.db.execute(
                delete(AdvisoryChatEntry).where(AdvisoryChatEntry.chat_id.in_(chat_ids))
            )

        for image in images:
            await self.db.delete(image)

        for chat in chats:
            await self.db.delete(chat)

        await self.db.execute(
            delete(AdvisoryRecord).where(AdvisoryRecord.case_id == record.case_id)
        )
        await self.db.execute(delete(AdvisoryCase).where(AdvisoryCase.id == case.id))
        await self.db.commit()

    async def require_case(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> AdvisoryCase:
        case = await self.db.get(AdvisoryCase, case_id)
        if case is None or case.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Advisory case not found.",
            )
        return case

    async def get_chat_id(
        self,
        *,
        user_id: str,
        case_id: str,
    ) -> str | None:
        await self.require_case(user_id=user_id, case_id=case_id)
        result = await self.db.execute(
            select(AdvisoryChat.id).where(AdvisoryChat.case_id == case_id)
        )
        return result.scalar_one_or_none()

    async def _get_record_row(self, case_id: str) -> AdvisoryRecord:
        record = await self.db.get(AdvisoryRecord, case_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Advisory record not found.",
            )
        return record

    async def _create_case_row(
        self,
        *,
        user_id: str,
        title: str,
    ) -> AdvisoryCase:
        cleaned_title = title.strip()
        case = AdvisoryCase(
            id=f"case_{uuid4().hex}",
            user_id=user_id,
            title=cleaned_title,
        )
        self.db.add(case)
        self.db.add(
            AdvisoryRecord(
                case_id=case.id,
                payload_json=AdvisoryRecordPayload(
                    version="v2",
                    title=cleaned_title,
                    profile_description=None,
                    default_location=None,
                    subjects=[],
                    reports=[],
                    queries=[],
                    measurements=[],
                    materials=[],
                ).model_dump(mode="json"),
            )
        )
        await self.db.commit()
        return case

    async def _serialize_case_summary(self, case: AdvisoryCase) -> AdvisoryCaseSummary:
        record = await self._get_record_row(case.id)
        record_payload = AdvisoryRecordPayload.model_validate(record.payload_json)
        chat_result = await self.db.execute(
            select(AdvisoryChat.id).where(AdvisoryChat.case_id == case.id)
        )
        image_count_result = await self.db.execute(
            select(func.count(AdvisoryImage.id)).where(
                AdvisoryImage.case_id == case.id,
                AdvisoryImage.status != "deleted",
            )
        )
        return AdvisoryCaseSummary(
            id=case.id,
            title=record_payload.title or case.title,
            chat_id=chat_result.scalar_one_or_none(),
            image_count=int(image_count_result.scalar_one() or 0),
            created_at=self._iso(case.created_at),
            updated_at=self._iso(case.updated_at),
        )

    def _iso(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
