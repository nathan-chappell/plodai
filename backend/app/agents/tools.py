from agents import function_tool

from app.agents.context import ReportAgentContext


@function_tool
def list_accessible_datasets(context: ReportAgentContext) -> dict:
    return {
        "dataset_ids": context.dataset_ids,
        "thread_metadata": context.thread_metadata,
        "note": "Replace with persisted dataset inventory once upload/query storage is wired.",
    }


@function_tool
def inspect_dataset_schema(dataset_id: str, context: ReportAgentContext | None = None) -> dict:
    return {
        "dataset_id": dataset_id,
        "status": "stub",
        "thread_metadata_keys": sorted((context.thread_metadata if context else {}).keys()),
        "note": "Return column metadata, row counts, and capped sample rows.",
    }


@function_tool
def run_aggregate_query(dataset_id: str, question: str, context: ReportAgentContext | None = None) -> dict:
    return {
        "dataset_id": dataset_id,
        "question": question,
        "status": "stub",
        "user": context.user_email if context else None,
        "note": "Execute only bounded aggregate queries, never unrestricted raw table reads.",
    }


@function_tool
def request_chart_render(query_id: str, chart_intent: str, context: ReportAgentContext | None = None) -> dict:
    return {
        "query_id": query_id,
        "chart_intent": chart_intent,
        "status": "stub",
        "report_id": context.report_id if context else None,
        "note": "Frontend should render the chart, cache it by query id, and optionally return an image for visual reasoning.",
    }


@function_tool
def append_report_section(title: str, markdown: str, context: ReportAgentContext | None = None) -> dict:
    return {
        "title": title,
        "markdown": markdown,
        "status": "stub",
        "report_id": context.report_id if context else None,
        "note": "Persist this as a report artifact section using the thread metadata and store when the report pipeline is finalized.",
    }
