from app.agents.context import DatasetMetadata
from app.agents.query_models import ChartPlan, ToolQueryPlan, build_query_plan_model


def build_datasets() -> list[DatasetMetadata]:
    return [
        DatasetMetadata(
            id="sales_csv",
            name="Sales",
            columns=["region", "revenue", "units", "category"],
            numeric_columns=["revenue", "units"],
        )
    ]


def test_query_plan_accepts_valid_grouped_aggregate_plan() -> None:
    query_plan_model, _ = build_query_plan_model(build_datasets())

    plan = query_plan_model.model_validate(
        {
            "dataset_id": "sales_csv",
            "where": {
                "kind": "binary",
                "op": "gt",
                "left": {"kind": "column", "column": "revenue"},
                "right": {"kind": "literal", "value": 100},
            },
            "group_by": [
                {
                    "as": "region",
                    "expr": {"kind": "column", "column": "region"},
                }
            ],
            "aggregates": [
                {"op": "sum", "as": "total_revenue", "expr": {"kind": "column", "column": "revenue"}},
                {"op": "count", "as": "row_count"},
            ],
            "limit": 20,
        }
    )

    dumped = plan.model_dump(by_alias=True)
    assert dumped["dataset_id"] == "sales_csv"
    assert dumped["group_by"][0]["as"] == "region"
    assert dumped["aggregates"][0]["op"] == "sum"


def test_query_plan_rejects_unknown_dataset_and_columns() -> None:
    query_plan_model, _ = build_query_plan_model(build_datasets())

    try:
        query_plan_model.model_validate(
            {
                "dataset_id": "inventory_csv",
                "aggregates": [{"op": "count", "as": "row_count"}],
            }
        )
    except Exception as exc:
        assert "sales_csv" in str(exc)
    else:
        raise AssertionError("Expected dataset literal validation to fail")

    try:
        query_plan_model.model_validate(
            {
                "dataset_id": "sales_csv",
                "where": {
                    "kind": "column",
                    "column": "profit_margin",
                },
            }
        )
    except Exception as exc:
        assert "revenue" in str(exc)
    else:
        raise AssertionError("Expected column literal validation to fail")


def test_query_plan_restricts_describe_numeric_to_numeric_columns() -> None:
    query_plan_model, _ = build_query_plan_model(build_datasets())

    valid_plan = query_plan_model.model_validate(
        {
            "dataset_id": "sales_csv",
            "aggregates": [{"op": "describe_numeric", "column": "revenue", "prefix": "revenue"}],
        }
    )
    assert valid_plan.model_dump(by_alias=True)["aggregates"][0]["column"] == "revenue"

    try:
        query_plan_model.model_validate(
            {
                "dataset_id": "sales_csv",
                "aggregates": [{"op": "describe_numeric", "column": "region"}],
            }
        )
    except Exception as exc:
        assert "units" in str(exc) or "revenue" in str(exc)
    else:
        raise AssertionError("Expected numeric column restriction to fail")


def test_query_plan_schema_exposes_expected_aggregate_variants() -> None:
    _, schema = build_query_plan_model(build_datasets())
    schema_text = str(schema)

    assert "describe_numeric" in schema_text
    assert "null_count" in schema_text
    assert "count_distinct" in schema_text


def test_tool_models_use_anyof_and_forbid_freeform_dicts() -> None:
    query_schema = ToolQueryPlan.model_json_schema()
    chart_schema = ChartPlan.model_json_schema()
    schema_text = str(query_schema)

    assert "oneOf" not in schema_text
    assert "additionalProperties': True" not in schema_text
    assert "anyOf" in schema_text
    assert chart_schema.get("additionalProperties") is False
