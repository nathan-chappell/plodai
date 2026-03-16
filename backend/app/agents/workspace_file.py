from dataclasses import dataclass, field
from typing import Any, Literal


WorkspaceFileKind = Literal["csv", "pdf", "other"]


@dataclass
class CsvWorkspaceMetadata:
    row_count: int = 0
    columns: list[str] = field(default_factory=list)
    numeric_columns: list[str] = field(default_factory=list)
    sample_rows: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class PdfWorkspaceMetadata:
    page_count: int | None = None


@dataclass
class WorkspaceFileMetadata:
    id: str
    name: str
    kind: WorkspaceFileKind
    extension: str = ""
    mime_type: str | None = None
    byte_size: int | None = None
    csv: CsvWorkspaceMetadata | None = None
    pdf: PdfWorkspaceMetadata | None = None
