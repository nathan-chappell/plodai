from typing import TypedDict

from backend.app.agents.DatasetMetadata import DatasetMetadata


class ThreadDatasetMetadata(TypedDict):
    id: str
    name: str
    row_count: int
    columns: list[str]
    numeric_columns: list[str]
    sample_rows: list[dict[str, str]]


class ThreadMetadataPatch(TypedDict, total=False):
    title: str
    dataset_ids: list[str]
    datasets: list[ThreadDatasetMetadata]
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str


class AppThreadMetadata(TypedDict, total=False):
    title: str
    dataset_ids: list[str]
    datasets: list[ThreadDatasetMetadata]
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str


def normalize_thread_metadata(raw_metadata: object | None) -> AppThreadMetadata:
    if not isinstance(raw_metadata, dict):
        return {}

    metadata: AppThreadMetadata = {}

    title = raw_metadata.get("title")
    if isinstance(title, str) and title:
        metadata["title"] = title

    dataset_ids = raw_metadata.get("dataset_ids")
    if isinstance(dataset_ids, list):
        metadata["dataset_ids"] = [
            str(dataset_id) for dataset_id in dataset_ids if str(dataset_id)
        ]

    datasets = raw_metadata.get("datasets")
    if isinstance(datasets, list):
        normalized_datasets: list[ThreadDatasetMetadata] = []
        for dataset in datasets:
            if not isinstance(dataset, dict):
                continue
            sample_rows = dataset.get("sample_rows", [])
            normalized_datasets.append(
                {
                    "id": str(dataset.get("id", "")),
                    "name": str(dataset.get("name", "dataset")),
                    "row_count": int(dataset.get("row_count", 0)),
                    "columns": [str(column) for column in dataset.get("columns", [])],
                    "numeric_columns": [
                        str(column) for column in dataset.get("numeric_columns", [])
                    ],
                    "sample_rows": [
                        {str(key): str(value) for key, value in row.items()}
                        for row in sample_rows
                        if isinstance(row, dict)
                    ],
                }
            )
        metadata["datasets"] = [
            dataset for dataset in normalized_datasets if dataset["id"]
        ]

    chart_cache = raw_metadata.get("chart_cache")
    if isinstance(chart_cache, dict):
        metadata["chart_cache"] = {
            str(key): str(value)
            for key, value in chart_cache.items()
            if isinstance(key, str) and isinstance(value, str)
        }

    conversation_id = raw_metadata.get("openai_conversation_id")
    if isinstance(conversation_id, str) and conversation_id:
        metadata["openai_conversation_id"] = conversation_id

    previous_response_id = raw_metadata.get("openai_previous_response_id")
    if isinstance(previous_response_id, str) and previous_response_id:
        metadata["openai_previous_response_id"] = previous_response_id

    return metadata


def merge_thread_metadata(
    current: AppThreadMetadata, patch: ThreadMetadataPatch
) -> AppThreadMetadata:
    merged: AppThreadMetadata = {**current}
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def datasets_from_thread_metadata(metadata: AppThreadMetadata) -> list[DatasetMetadata]:
    datasets: list[DatasetMetadata] = []
    for raw_dataset in metadata.get("datasets", []):
        datasets.append(
            DatasetMetadata(
                id=raw_dataset["id"],
                name=raw_dataset["name"],
                columns=list(raw_dataset["columns"]),
                sample_rows=[dict(row) for row in raw_dataset["sample_rows"]],
                row_count=raw_dataset["row_count"],
                numeric_columns=list(raw_dataset["numeric_columns"]),
            )
        )
    return datasets
