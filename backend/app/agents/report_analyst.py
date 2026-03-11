from agents import Agent

from app.agents.context import ReportAgentContext
from app.agents.tools import (
    append_report_section,
    inspect_dataset_schema,
    list_accessible_datasets,
    request_chart_render,
    run_aggregate_query,
)


report_analyst = Agent[ReportAgentContext](
    name="Report Foundry Analyst",
    model="gpt-5.1",
    instructions=(
        "You are an analyst agent that investigates uploaded CSV datasets using only safe abstractions. "
        "Never request unrestricted raw data. Prefer schema inspection, grouped summaries, bounded samples, "
        "and chart requests that can be rendered client-side and returned as images when interpretation would benefit. "
        "Assemble the final answer as report sections plus chart recommendations."
    ),
    tools=[
        list_accessible_datasets,
        inspect_dataset_schema,
        run_aggregate_query,
        request_chart_render,
        append_report_section,
    ],
)
