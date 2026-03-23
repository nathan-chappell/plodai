from typing import Any, Literal, TypeAlias, Union

from pydantic import BaseModel, ConfigDict, Field

from backend.app.agents.DatasetMetadata import DatasetMetadata

UnaryOpLiteral: TypeAlias = Literal["not", "negate"]
BinaryOpLiteral: TypeAlias = Literal[
    "add",
    "sub",
    "mul",
    "div",
    "mod",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "and",
    "or",
]
CallLiteral: TypeAlias = Literal[
    "lower",
    "upper",
    "trim",
    "abs",
    "round",
    "floor",
    "ceil",
    "coalesce",
]
AggregateOpLiteral: TypeAlias = Literal[
    "sum",
    "avg",
    "min",
    "max",
    "first",
    "last",
    "median",
    "variance",
    "stddev",
]
ChartTypeLiteral: TypeAlias = Literal["bar", "line", "pie", "doughnut", "scatter"]
ChartStylePresetLiteral: TypeAlias = Literal[
    "editorial",
    "sunrise",
    "ocean",
    "forest",
    "mono",
    "ledger",
    "amber",
    "cobalt",
    "terracotta",
    "midnight",
]
ChartLegendPositionLiteral: TypeAlias = Literal["top", "bottom", "left", "right"]
ChartOrientationLiteral: TypeAlias = Literal["vertical", "horizontal"]
ChartValueFormatLiteral: TypeAlias = Literal[
    "number", "integer", "currency", "percent", "compact", "string"
]


def _literal_type(values: tuple[str, ...]):
    return Literal[*values]


class QueryModelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class StaticLiteralExpr(QueryModelBase):
    kind: Literal["literal"]
    value: str | int | float | bool | None


class StaticColumnExpr(QueryModelBase):
    kind: Literal["column"]
    column: str


class StaticUnaryExpr(QueryModelBase):
    kind: Literal["unary"]
    op: UnaryOpLiteral
    value: "StaticRowExpr"


class StaticBinaryExpr(QueryModelBase):
    kind: Literal["binary"]
    op: BinaryOpLiteral
    left: "StaticRowExpr"
    right: "StaticRowExpr"


class StaticCallExpr(QueryModelBase):
    kind: Literal["call"]
    fn: CallLiteral
    args: list["StaticRowExpr"]


StaticRowExpr: TypeAlias = Union[
    StaticLiteralExpr,
    StaticColumnExpr,
    StaticUnaryExpr,
    StaticBinaryExpr,
    StaticCallExpr,
]


class StaticProjectField(QueryModelBase):
    as_: str = Field(alias="as")
    expr: StaticRowExpr


class StaticGroupKey(QueryModelBase):
    as_: str = Field(alias="as")
    expr: StaticRowExpr


class StaticSortSpec(QueryModelBase):
    field: str
    direction: Literal["asc", "desc"]


class StaticCountMeasure(QueryModelBase):
    op: Literal["count"]
    as_: str = Field(alias="as")


class StaticNullCountMeasure(QueryModelBase):
    op: Literal["null_count"]
    as_: str = Field(alias="as")
    expr: StaticRowExpr


class StaticCountDistinctMeasure(QueryModelBase):
    op: Literal["count_distinct"]
    as_: str = Field(alias="as")
    expr: StaticRowExpr


class StaticExprMeasure(QueryModelBase):
    op: AggregateOpLiteral
    as_: str = Field(alias="as")
    expr: StaticRowExpr


class StaticDescribeNumericMeasure(QueryModelBase):
    op: Literal["describe_numeric"]
    column: str
    prefix: str | None = None


StaticAggregateSpec: TypeAlias = Union[
    StaticCountMeasure,
    StaticNullCountMeasure,
    StaticCountDistinctMeasure,
    StaticExprMeasure,
    StaticDescribeNumericMeasure,
]


class ToolQueryPlan(QueryModelBase):
    dataset_id: str
    where: StaticRowExpr | None = None
    project: list[StaticProjectField] | None = None
    group_by: list[StaticGroupKey] | None = None
    aggregates: list[StaticAggregateSpec] | None = None
    sort: list[StaticSortSpec] | None = None
    limit: int | None = Field(default=None, ge=1, le=500)


class ChartSeries(QueryModelBase):
    label: str
    data_key: str
    color: str | None = None


class ChartPlan(QueryModelBase):
    type: ChartTypeLiteral
    title: str
    subtitle: str | None = None
    description: str | None = None
    label_key: str
    series: list[ChartSeries]
    style_preset: ChartStylePresetLiteral | None = None
    x_axis_label: str | None = None
    y_axis_label: str | None = None
    legend_position: ChartLegendPositionLiteral | None = None
    orientation: ChartOrientationLiteral | None = None
    value_format: ChartValueFormatLiteral | None = None
    show_legend: bool | None = None
    stacked: bool | None = None
    smooth: bool | None = None
    interactive: bool | None = None
    show_grid: bool | None = None
    show_data_labels: bool | None = None
    fill_area: bool | None = None


StaticUnaryExpr.model_rebuild(_types_namespace={"StaticRowExpr": StaticRowExpr})
StaticBinaryExpr.model_rebuild(_types_namespace={"StaticRowExpr": StaticRowExpr})
StaticCallExpr.model_rebuild(_types_namespace={"StaticRowExpr": StaticRowExpr})
ToolQueryPlan.model_rebuild(
    _types_namespace={
        "StaticRowExpr": StaticRowExpr,
        "StaticAggregateSpec": StaticAggregateSpec,
    }
)


def build_query_plan_model(
    datasets: list[DatasetMetadata],
) -> tuple[type[BaseModel], dict[str, Any]]:
    dataset_ids = tuple(dataset.id for dataset in datasets) or ("unknown_dataset",)
    all_columns = tuple(
        sorted({column for dataset in datasets for column in dataset.columns})
    ) or ("unknown_column",)
    numeric_columns = (
        tuple(
            sorted(
                {column for dataset in datasets for column in dataset.numeric_columns}
            )
        )
        or all_columns
    )

    DatasetIdLiteral = _literal_type(dataset_ids)
    ColumnLiteral = _literal_type(all_columns)
    NumericColumnLiteral = _literal_type(numeric_columns)

    class LiteralExpr(QueryModelBase):
        kind: Literal["literal"]
        value: str | int | float | bool | None

    class ColumnExpr(QueryModelBase):
        kind: Literal["column"]
        column: ColumnLiteral  # pyright: ignore[reportInvalidTypeForm]

    class UnaryExpr(QueryModelBase):
        kind: Literal["unary"]
        op: UnaryOpLiteral
        value: "RowExpr"  # pyright: ignore[reportInvalidTypeForm]

    class BinaryExpr(QueryModelBase):
        kind: Literal["binary"]
        op: BinaryOpLiteral
        left: "RowExpr"  # pyright: ignore[reportInvalidTypeForm]
        right: "RowExpr"  # pyright: ignore[reportInvalidTypeForm]

    class CallExpr(QueryModelBase):
        kind: Literal["call"]
        fn: CallLiteral
        args: list["RowExpr"]  # pyright: ignore[reportInvalidTypeForm]

    RowExpr = Union[LiteralExpr, ColumnExpr, UnaryExpr, BinaryExpr, CallExpr]

    class ProjectField(QueryModelBase):
        as_: str = Field(alias="as")
        expr: RowExpr  # pyright: ignore[reportInvalidTypeForm]

    class GroupKey(QueryModelBase):
        as_: str = Field(alias="as")
        expr: RowExpr  # pyright: ignore[reportInvalidTypeForm]

    class SortSpec(QueryModelBase):
        field: str
        direction: Literal["asc", "desc"]

    class CountMeasure(QueryModelBase):
        op: Literal["count"]
        as_: str = Field(alias="as")

    class NullCountMeasure(QueryModelBase):
        op: Literal["null_count"]
        as_: str = Field(alias="as")
        expr: RowExpr  # pyright: ignore[reportInvalidTypeForm]

    class CountDistinctMeasure(QueryModelBase):
        op: Literal["count_distinct"]
        as_: str = Field(alias="as")
        expr: RowExpr  # pyright: ignore[reportInvalidTypeForm]

    class ExprMeasure(QueryModelBase):
        op: AggregateOpLiteral
        as_: str = Field(alias="as")
        expr: RowExpr  # pyright: ignore[reportInvalidTypeForm]

    class DescribeNumericMeasure(QueryModelBase):
        op: Literal["describe_numeric"]
        column: NumericColumnLiteral  # pyright: ignore[reportInvalidTypeForm]
        prefix: str | None = None

    AggregateSpec = Union[
        CountMeasure,
        NullCountMeasure,
        CountDistinctMeasure,
        ExprMeasure,
        DescribeNumericMeasure,
    ]

    class QueryPlan(QueryModelBase):
        dataset_id: DatasetIdLiteral  # pyright: ignore[reportInvalidTypeForm]
        where: RowExpr | None = None  # pyright: ignore[reportInvalidTypeForm]
        project: list[ProjectField] | None = None
        group_by: list[GroupKey] | None = None
        aggregates: list[AggregateSpec] | None = None  # pyright: ignore[reportInvalidTypeForm]
        sort: list[SortSpec] | None = None
        limit: int | None = Field(default=None, ge=1, le=500)

    UnaryExpr.model_rebuild(_types_namespace={"RowExpr": RowExpr})
    BinaryExpr.model_rebuild(_types_namespace={"RowExpr": RowExpr})
    CallExpr.model_rebuild(_types_namespace={"RowExpr": RowExpr})
    QueryPlan.model_rebuild(
        _types_namespace={"RowExpr": RowExpr, "AggregateSpec": AggregateSpec}
    )

    return QueryPlan, QueryPlan.model_json_schema()
