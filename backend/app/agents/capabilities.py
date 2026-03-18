from typing import Literal, TypeAlias


AgentCapability: TypeAlias = Literal[
    "report-agent",
    "csv-agent",
    "chart-agent",
    "pdf-agent",
    "workspace-agent",
    "feedback-agent",
]
