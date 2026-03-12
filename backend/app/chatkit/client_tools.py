from __future__ import annotations

from typing import TypedDict, cast


class ClientToolCsvFile(TypedDict):
    id: str
    name: str
    row_count: int
    columns: list[str]
    numeric_columns: list[str]
    sample_rows: list[dict[str, object]]


class ClientToolResultPayload(TypedDict, total=False):
    value: object
    query_id: str
    queryId: str
    row_count: int
    image_data_url: str
    imageDataUrl: str
    rows: list[dict[str, object]]
    chart: dict[str, object]
    csv_files: list[ClientToolCsvFile]


def coerce_client_tool_result(result: object | None) -> ClientToolResultPayload | None:
    if result is None:
        return None
    if isinstance(result, dict):
        return cast(ClientToolResultPayload, result)
    return {"value": result}
