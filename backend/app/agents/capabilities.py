from typing import Literal, TypeAlias


AgentToolProvider: TypeAlias = Literal[
    "report-agent",
    "data-agent",
    "csv-agent",
    "chart-agent",
    "pdf-agent",
    "feedback-agent",
]

AgentCapability = AgentToolProvider
