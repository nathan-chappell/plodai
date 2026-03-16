from typing import Literal, TypeAlias


AgentCapability: TypeAlias = Literal[
    "report-agent",
    "file-agent",
    "pdf-agent",
]
