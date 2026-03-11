from __future__ import annotations

from typing import TypedDict, cast


class ClientToolResultPayload(TypedDict, total=False):
    value: object
    query_id: str
    queryId: str
    row_count: int
    image_data_url: str
    imageDataUrl: str
    rows: list[dict[str, object]]
    chart: dict[str, object]


def coerce_client_tool_result(result: object | None) -> ClientToolResultPayload | None:
    if result is None:
        return None
    if isinstance(result, dict):
        return cast(ClientToolResultPayload, result)
    return {"value": result}
