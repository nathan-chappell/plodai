import asyncio
from types import SimpleNamespace

from backend.app.core.config import get_settings
from backend.app.db.session import AsyncSessionLocal
from backend.app.schemas.advisory import AdvisoryCaseCreateRequest, AdvisoryRecordPayload
from backend.app.services.advisory_semantic_service import AdvisorySemanticService, build_semantic_items
from backend.app.services.advisory_service import AdvisoryService


class FakeRagContext:
    def __init__(self, rag: "FakeRag") -> None:
        self.rag = rag

    async def __aenter__(self) -> "FakeRag":
        return self.rag

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


class FakeRag:
    def __init__(self) -> None:
        self.ingested: list[dict[str, object]] = []
        self.search_source_ids: list[str] = []

    async def ingest_text(self, text: str, **kwargs: object) -> SimpleNamespace:
        source_id = f"src_{len(self.ingested) + 1}"
        self.ingested.append({"source_id": source_id, "text": text, **kwargs})
        return SimpleNamespace(source=SimpleNamespace(id=source_id))

    async def search(self, query: str, **kwargs: object) -> SimpleNamespace:
        self.search_source_ids = list(kwargs.get("selected_source_ids") or [])
        hits = [
            SimpleNamespace(
                source_file_id=source_id,
                score=0.9 - (index * 0.1),
                title=f"hit {index}",
                summary=f"summary for {query}",
                text="full matching text",
            )
            for index, source_id in enumerate(self.search_source_ids, start=1)
        ]
        return SimpleNamespace(hits=hits)


def test_build_semantic_items_renders_reports_and_queries() -> None:
    record = _record()

    items = build_semantic_items(record)

    assert [(item.item_type, item.item_id) for item in items] == [
        ("report", "report_1"),
        ("query", "query_1"),
    ]
    assert "Walnut blight pressure" in items[0].text
    assert "Copper timing" in items[1].text
    assert all(item.content_hash for item in items)


def test_advisory_semantic_service_indexes_and_searches_saved_items() -> None:
    async def _run() -> None:
        fake_rag = FakeRag()
        settings = get_settings().model_copy(update={"semantic_search_enabled": True})
        async with AsyncSessionLocal() as db:
            advisory_service = AdvisoryService(db)
            advisory_case = await advisory_service.create_case(
                user_id="user_semantic",
                request=AdvisoryCaseCreateRequest(title="Semantic case"),
            )
            await advisory_service.save_record(
                user_id="user_semantic",
                case_id=advisory_case.id,
                record=_record(title="Semantic case"),
            )

            service = AdvisorySemanticService(
                db,
                settings=settings,
                advisory_service=advisory_service,
                rag_factory=lambda: FakeRagContext(fake_rag),
            )
            response = await service.search_reports_and_queries(
                user_id="user_semantic",
                case_id=advisory_case.id,
                query="blight copper",
            )
            second_response = await service.search_reports_and_queries(
                user_id="user_semantic",
                case_id=advisory_case.id,
                query="blight copper",
            )

        assert response.indexed_item_count == 2
        assert [hit.item_type for hit in response.hits] == ["report", "query"]
        assert fake_rag.search_source_ids == ["src_1", "src_2"]
        assert len(fake_rag.ingested) == 2
        assert second_response.indexed_item_count == 2

    asyncio.run(_run())


def test_advisory_semantic_service_can_be_disabled() -> None:
    async def _run() -> None:
        settings = get_settings().model_copy(update={"semantic_search_enabled": False})
        async with AsyncSessionLocal() as db:
            service = AdvisorySemanticService(db, settings=settings)
            response = await service.search_reports_and_queries(
                user_id="user_semantic_disabled",
                case_id="case_missing",
                query="anything",
            )

        assert response.skipped_reason == "Semantic search is disabled."
        assert response.indexed_item_count == 0

    asyncio.run(_run())


def _record(title: str = "North orchard") -> AdvisoryRecordPayload:
    return AdvisoryRecordPayload(
        version="v2",
        title=title,
        profile_description="Walnut orchard near the north road.",
        default_location="North block",
        subjects=[
            {
                "id": "subject_1",
                "name": "Walnut block",
                "kind": "crop",
                "type": "walnut",
                "location": "North block",
            }
        ],
        reports=[
            {
                "id": "report_1",
                "category": "disease",
                "title": "Walnut blight pressure",
                "description": "Dark lesions on leaves after wet weather.",
                "status": "monitoring",
                "severity": "medium",
                "recommended_follow_up": "Scout lower canopy and check extension guidance.",
                "subject_ids": ["subject_1"],
            }
        ],
        queries=[
            {
                "id": "query_1",
                "category": "plant_health",
                "question": "Copper timing",
                "status": "answered",
                "answer_summary": "Review local label timing before application.",
                "subject_ids": ["subject_1"],
            }
        ],
        measurements=[],
        materials=[],
    )
