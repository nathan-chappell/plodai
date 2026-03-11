import { describe, expect, it } from "vitest";

import { evaluateRowExpr, executeQueryPlan } from "../analysis";
import type { DataRow, QueryPlan, RowExpr } from "../../types/analysis";

const rows: DataRow[] = [
  { region: "North", category: "A", revenue: 100, units: 2 },
  { region: "North", category: "B", revenue: 150, units: 3 },
  { region: "South", category: "A", revenue: null, units: 1 },
  { region: "South", category: "B", revenue: 50, units: 1 },
];

describe("analysis runtime", () => {
  it("evaluates row expressions", () => {
    const expr: RowExpr = {
      kind: "binary",
      op: "add",
      left: { kind: "column", column: "units" },
      right: { kind: "literal", value: 4 },
    };

    expect(evaluateRowExpr(expr, rows[0])).toBe(6);
  });

  it("projects and filters rows", () => {
    const plan: QueryPlan = {
      dataset_id: "sales_csv",
      where: {
        kind: "binary",
        op: "eq",
        left: { kind: "column", column: "region" },
        right: { kind: "literal", value: "North" },
      },
      project: [
        { as: "region", expr: { kind: "column", column: "region" } },
        {
          as: "revenue_plus_one",
          expr: {
            kind: "binary",
            op: "add",
            left: { kind: "column", column: "revenue" },
            right: { kind: "literal", value: 1 },
          },
        },
      ],
    };

    expect(executeQueryPlan(rows, plan).rows).toEqual([
      { region: "North", revenue_plus_one: 101 },
      { region: "North", revenue_plus_one: 151 },
    ]);
  });

  it("groups rows and computes aggregates", () => {
    const plan: QueryPlan = {
      dataset_id: "sales_csv",
      group_by: [{ as: "region", expr: { kind: "column", column: "region" } }],
      aggregates: [
        { op: "count", as: "row_count" },
        { op: "sum", as: "total_revenue", expr: { kind: "column", column: "revenue" } },
        { op: "avg", as: "avg_units", expr: { kind: "column", column: "units" } },
      ],
      sort: [{ field: "region", direction: "asc" }],
    };

    expect(executeQueryPlan(rows, plan).rows).toEqual([
      { region: "North", row_count: 2, total_revenue: 250, avg_units: 2.5 },
      { region: "South", row_count: 2, total_revenue: 50, avg_units: 1 },
    ]);
  });

  it("expands describe_numeric without treating nulls as zero", () => {
    const plan: QueryPlan = {
      dataset_id: "sales_csv",
      group_by: [{ as: "region", expr: { kind: "column", column: "region" } }],
      aggregates: [{ op: "describe_numeric", column: "revenue", prefix: "revenue" }],
      sort: [{ field: "region", direction: "asc" }],
    };

    expect(executeQueryPlan(rows, plan).rows).toEqual([
      {
        region: "North",
        revenue_row_count: 2,
        revenue_null_count: 0,
        revenue_distinct_count: 2,
        revenue_min: 100,
        revenue_max: 150,
        revenue_sum: 250,
        revenue_avg: 125,
        revenue_median: 125,
        revenue_variance: 625,
        revenue_stddev: 25,
      },
      {
        region: "South",
        revenue_row_count: 2,
        revenue_null_count: 1,
        revenue_distinct_count: 1,
        revenue_min: 50,
        revenue_max: 50,
        revenue_sum: 50,
        revenue_avg: 50,
        revenue_median: 50,
        revenue_variance: 0,
        revenue_stddev: 0,
      },
    ]);
  });
});
