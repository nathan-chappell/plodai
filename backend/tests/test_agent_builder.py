from types import SimpleNamespace

import pytest
from agents import WebSearchTool

from backend.app.agents.agent_builder import (
    BASE_INSTRUCTIONS,
    _build_model_settings,
    build_plodai_agent,
)
from backend.app.agents.context import AdvisoryAgentContext, resolve_preferred_output_language
from backend.app.schemas.advisory import AdvisoryImageSummary, AdvisoryRecordPayload

pytestmark = pytest.mark.no_db


def test_build_plodai_agent_uses_static_instructions() -> None:
    context = AdvisoryAgentContext(
        chat_id="chat-123",
        user_id="user-123",
        user_email="farmer@example.com",
        db=SimpleNamespace(),
        case_id="case-123",
        case_title="North Orchard",
        thread_title="Blight check",
        assistant_turn_count=7,
        thread_metadata={"title": "Blight check"},
        current_record=AdvisoryRecordPayload(
            version="v2",
            title="North Orchard",
            profile_description="Scout twice weekly.",
            default_location="Parcel 4",
            subjects=[],
            reports=[],
            queries=[],
            measurements=[],
            materials=[],
        ),
        advisory_images=[
            AdvisoryImageSummary(
                id="img-123",
                case_id="case-123",
                chat_id=None,
                attachment_id=None,
                source_kind="upload",
                name="Leaf closeup",
                mime_type="image/jpeg",
                byte_size=1234,
                width=1600,
                height=1200,
                preview_url="https://example.test/image.jpg",
                created_at="2026-03-25T00:00:00Z",
                updated_at="2026-03-25T00:00:00Z",
            )
        ],
    )

    agent = build_plodai_agent(context, model="gpt-5.4-mini")

    assert isinstance(agent.instructions, str)
    assert agent.instructions.startswith(BASE_INSTRUCTIONS)
    assert "Output language:" in agent.instructions
    assert "North Orchard" not in agent.instructions
    assert "Parcel 4" not in agent.instructions
    assert "Previous assistant turns" not in agent.instructions
    assert "Reply in Croatian by default." in agent.instructions


def test_build_plodai_agent_supports_english_output_preference() -> None:
    context = AdvisoryAgentContext(
        chat_id="chat-123",
        user_id="user-123",
        user_email="farmer@example.com",
        db=SimpleNamespace(),
        case_id="case-123",
        case_title="North Orchard",
        preferred_output_language="en",
    )

    agent = build_plodai_agent(context, model="gpt-5.4-mini")

    assert isinstance(agent.instructions, str)
    assert agent.instructions.startswith(BASE_INSTRUCTIONS)
    assert "Reply in English by default." in agent.instructions
    assert "Croatian (`hr`)" not in agent.instructions


def test_base_instructions_describe_tools_and_eager_record_updates() -> None:
    assert "`get_advisory_record`" in BASE_INSTRUCTIONS
    assert "`save_advisory_record`" in BASE_INSTRUCTIONS
    assert "`search_advisory_memory`" in BASE_INSTRUCTIONS
    assert "`name_current_thread`" in BASE_INSTRUCTIONS
    assert "farmer support and field intelligence assistant" in BASE_INSTRUCTIONS
    assert "digital AKIS-style workspace" in BASE_INSTRUCTIONS
    assert "Shoot first with the advisory data model." in BASE_INSTRUCTIONS
    assert "treat that as permission to update the advisory record immediately" in BASE_INSTRUCTIONS
    assert "inspect them thoroughly and at full detail" in BASE_INSTRUCTIONS
    assert 'Do not default to "no issues"' in BASE_INSTRUCTIONS
    assert "`subjects`, `reports`, `queries`, `measurements`, and `materials`" in BASE_INSTRUCTIONS
    assert "Prefer a richly filled valid record over a sparse one." in BASE_INSTRUCTIONS
    assert "Translate conversational facts into structured fields." in BASE_INSTRUCTIONS
    assert "fill every supported field you can justify from the current evidence" in BASE_INSTRUCTIONS
    assert "subjects, reports, queries, measurements, and materials" in BASE_INSTRUCTIONS
    assert "input shortages, market bottlenecks, infrastructure damage" in BASE_INSTRUCTIONS
    assert "save them instead of leaving them implicit in the chat" in BASE_INSTRUCTIONS
    assert "Mark inferred values explicitly as approximate." in BASE_INSTRUCTIONS
    assert "Prefer numeric-plus-unit estimates when inferable" in BASE_INSTRUCTIONS
    assert "If `title` is blank, generic, or a placeholder such as `New advisory case`" in BASE_INSTRUCTIONS
    assert "record at least one concrete `report`" in BASE_INSTRUCTIONS
    assert "Within 1-2 weeks, inspect 10-20 leaves per tree" in BASE_INSTRUCTIONS
    assert "If suspected mildew/leaf spot, note humidity periods and consider targeted fungicide based on local extension guidance" in BASE_INSTRUCTIONS
    assert "do not stop at diagnosis and monitoring alone" in BASE_INSTRUCTIONS
    assert "find likely treatment approaches and 1-3 practical material or supplier links" in BASE_INSTRUCTIONS
    assert "Prefer official or institutionally reliable Croatian sources" in BASE_INSTRUCTIONS
    assert "poljoprivreda.gov.hr" in BASE_INSTRUCTIONS
    assert "HAPIH" in BASE_INSTRUCTIONS
    assert "APPRRR" in BASE_INSTRUCTIONS
    assert "vendor, retailer, cooperative, producer, and manufacturer pages only after the official or institutional check" in BASE_INSTRUCTIONS
    assert "pesticide, fertilizer, veterinary, plant-health, food-safety" in BASE_INSTRUCTIONS
    assert "current or public facts would materially improve the answer" in BASE_INSTRUCTIONS
    assert "use hosted web search when appropriate, summarize cautiously, and include short inline markdown links to supporting sources in your reply" in BASE_INSTRUCTIONS
    assert "end with a short `References:` block" in BASE_INSTRUCTIONS
    assert "Clearly distinguish observed evidence from sourced treatment suggestions." in BASE_INSTRUCTIONS
    assert "treatments depend on local labels and extension guidance" in BASE_INSTRUCTIONS
    assert "Label confidence in practical language when useful" in BASE_INSTRUCTIONS
    assert "do not internalize it as built-in knowledge and do not hard-code it into your recommendations" in BASE_INSTRUCTIONS


def test_build_plodai_agent_exposes_hosted_web_search_tool() -> None:
    context = AdvisoryAgentContext(
        chat_id="chat-123",
        user_id="user-123",
        user_email="farmer@example.com",
        db=SimpleNamespace(),
        case_id="case-123",
        case_title="North Orchard",
    )

    agent = build_plodai_agent(context, model="gpt-5.4-mini")

    assert any(isinstance(tool, WebSearchTool) for tool in agent.tools)
    assert "search_advisory_memory" in {
        getattr(tool, "name", None) for tool in agent.tools
    }


def test_build_model_settings_requests_web_search_sources() -> None:
    context = AdvisoryAgentContext(
        chat_id="chat-123",
        user_id="user-123",
        user_email="farmer@example.com",
        db=SimpleNamespace(),
        case_id="case-123",
        case_title="North Orchard",
    )

    settings = _build_model_settings(context)

    assert settings.response_include == ["web_search_call.action.sources"]


def test_resolve_preferred_output_language_defaults_to_croatian() -> None:
    assert resolve_preferred_output_language(None) == "hr"
    assert resolve_preferred_output_language("") == "hr"
    assert resolve_preferred_output_language("de") == "hr"
    assert resolve_preferred_output_language(" EN ") == "en"
