from agents import function_tool

from app.agents.context import ReportAgentContext


@function_tool
def list_accessible_datasets(context: ReportAgentContext) -> dict:
    return {
        "dataset_ids": context.dataset_ids,
        "note": "Replace with persisted dataset inventory once upload/query storage is wired.",
    }


@function_tool
def inspect_dataset_schema(dataset_id: str) -> dict:
    return {
        "dataset_id": dataset_id,
        "status": "stub",
        "note": "Return column metadata, row counts, and capped sample rows.",
    }


@function_tool
def run_aggregate_query(dataset_id: str, question: str) -> dict:
    return {
        "dataset_id": dataset_id,
        "question": question,
        "status": "stub",
        "note": "Execute only bounded aggregate queries, never unrestricted raw table reads.",
    }


@function_tool
def request_chart_render(query_id: str, chart_intent: str) -> dict:
    return {
        "query_id": query_id,
        "chart_intent": chart_intent,
        "status": "stub",
        "note": "Frontend should render the chart, cache it by query id, and optionally return an image for visual reasoning.",
    }


@function_tool
def append_report_section(title: str, markdown: str) -> dict:
    return {
        "title": title,
        "markdown": markdown,
        "status": "stub",
        "note": "Persist this as a report artifact section once the conversation store is chosen.",
    }
