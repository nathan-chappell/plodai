from dataclasses import dataclass, field


@dataclass
class ReportAgentContext:
    report_id: str
    user_email: str
    dataset_ids: list[str] = field(default_factory=list)
    chart_cache: dict[str, str] = field(default_factory=dict)
