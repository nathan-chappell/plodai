from dataclasses import dataclass, field
from typing import Any


@dataclass
class DatasetMetadata:
    id: str
    name: str
    columns: list[str]
    sample_rows: list[dict[str, Any]] = field(default_factory=list)
    row_count: int = 0
    numeric_columns: list[str] = field(default_factory=list)
