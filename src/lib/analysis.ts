import type { AggregateSpec, DataRow, PrimitiveValue, ProjectField, QueryPlan, RowExpr } from "../types/analysis";

export type AnalysisResult = {
  rows: DataRow[];
};

type ExecutableAggregateSpec = Exclude<AggregateSpec, { op: "describe_numeric" }>;

type AggregateState =
  | { op: "count"; value: number }
  | { op: "null_count"; value: number }
  | { op: "count_distinct"; values: Set<string> }
  | { op: "sum"; value: number }
  | { op: "avg"; sum: number; count: number }
  | { op: "min"; value: number | null }
  | { op: "max"; value: number | null }
  | { op: "first"; seen: boolean; value: PrimitiveValue }
  | { op: "last"; value: PrimitiveValue }
  | { op: "median" | "variance" | "stddev"; values: number[] };

type GroupState = {
  keys: DataRow;
  measures: Record<string, AggregateState>;
};

export function executeQueryPlan(rows: DataRow[], plan: QueryPlan): AnalysisResult {
  const filtered = plan.where ? rows.filter((row) => Boolean(evaluateRowExpr(plan.where as RowExpr, row))) : rows;

  if (plan.aggregates?.length) {
    const grouped = aggregateRows(filtered, plan);
    const sorted = sortRows(grouped, plan.sort);
    const limited = typeof plan.limit === "number" ? sorted.slice(0, plan.limit) : sorted;
    return { rows: limited };
  }

  const projected = plan.project?.length ? filtered.map((row) => projectRow(row, plan.project as ProjectField[])) : filtered;
  const sorted = sortRows(projected, plan.sort);
  const limited = typeof plan.limit === "number" ? sorted.slice(0, plan.limit) : sorted;
  return { rows: limited };
}

export function evaluateRowExpr(expression: RowExpr, row: DataRow): PrimitiveValue {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "column":
      return row[expression.column] ?? null;
    case "unary": {
      const value = evaluateRowExpr(expression.value, row);
      return expression.op === "negate" ? -toNumber(value) : !Boolean(value);
    }
    case "binary": {
      const left = evaluateRowExpr(expression.left, row);
      const right = evaluateRowExpr(expression.right, row);
      switch (expression.op) {
        case "add":
          return toNumber(left) + toNumber(right);
        case "sub":
          return toNumber(left) - toNumber(right);
        case "mul":
          return toNumber(left) * toNumber(right);
        case "div":
          return toNumber(right) === 0 ? 0 : toNumber(left) / toNumber(right);
        case "mod":
          return toNumber(right) === 0 ? 0 : toNumber(left) % toNumber(right);
        case "eq":
          return left === right;
        case "neq":
          return left !== right;
        case "gt":
          return comparePrimitive(left, right) > 0;
        case "gte":
          return comparePrimitive(left, right) >= 0;
        case "lt":
          return comparePrimitive(left, right) < 0;
        case "lte":
          return comparePrimitive(left, right) <= 0;
        case "and":
          return Boolean(left) && Boolean(right);
        case "or":
          return Boolean(left) || Boolean(right);
      }
    }
    case "call": {
      const values = expression.args.map((argument) => evaluateRowExpr(argument, row));
      switch (expression.fn) {
        case "lower":
          return String(values[0] ?? "").toLowerCase();
        case "upper":
          return String(values[0] ?? "").toUpperCase();
        case "trim":
          return String(values[0] ?? "").trim();
        case "abs":
          return Math.abs(toNumber(values[0]));
        case "round":
          return Math.round(toNumber(values[0]));
        case "floor":
          return Math.floor(toNumber(values[0]));
        case "ceil":
          return Math.ceil(toNumber(values[0]));
        case "coalesce":
          return values.find((value) => value !== null && value !== "") ?? null;
      }
    }
  }
}

function projectRow(row: DataRow, project: ProjectField[]): DataRow {
  return Object.fromEntries(project.map((field) => [field.as, evaluateRowExpr(field.expr, row)]));
}

function aggregateRows(rows: DataRow[], plan: QueryPlan): DataRow[] {
  const groupBy = plan.group_by ?? [];
  const aggregates = expandAggregateSpecs(plan.aggregates ?? []);
  const groups = rows.reduce<Record<string, GroupState>>((accumulator, row) => {
    const keyValues = Object.fromEntries(groupBy.map((key) => [key.as, evaluateRowExpr(key.expr, row)]));
    const groupKey = JSON.stringify(keyValues);
    const group = accumulator[groupKey] ?? { keys: keyValues, measures: initializeMeasures(aggregates) };
    for (const aggregate of aggregates) {
      group.measures[aggregate.as] = applyAggregate(group.measures[aggregate.as], aggregate, row);
    }
    accumulator[groupKey] = group;
    return accumulator;
  }, {});

  return Object.values(groups).map((group) => ({
    ...group.keys,
    ...finalizeMeasures(group.measures),
  }));
}

function expandAggregateSpecs(aggregates: AggregateSpec[]): ExecutableAggregateSpec[] {
  return aggregates.flatMap((aggregate) => {
    if (aggregate.op !== "describe_numeric") {
      return [aggregate];
    }
    const prefix = aggregate.prefix ?? aggregate.column;
    const expr: RowExpr = { kind: "column", column: aggregate.column };
    return [
      { op: "count", as: `${prefix}_row_count` },
      { op: "null_count", as: `${prefix}_null_count`, expr },
      { op: "count_distinct", as: `${prefix}_distinct_count`, expr },
      { op: "min", as: `${prefix}_min`, expr },
      { op: "max", as: `${prefix}_max`, expr },
      { op: "sum", as: `${prefix}_sum`, expr },
      { op: "avg", as: `${prefix}_avg`, expr },
      { op: "median", as: `${prefix}_median`, expr },
      { op: "variance", as: `${prefix}_variance`, expr },
      { op: "stddev", as: `${prefix}_stddev`, expr },
    ];
  });
}

function initializeMeasures(aggregates: ExecutableAggregateSpec[]): Record<string, AggregateState> {
  return Object.fromEntries(aggregates.map((aggregate) => [aggregate.as, createAggregateState(aggregate)]));
}

function createAggregateState(aggregate: ExecutableAggregateSpec): AggregateState {
  switch (aggregate.op) {
    case "count":
      return { op: "count", value: 0 };
    case "null_count":
      return { op: "null_count", value: 0 };
    case "count_distinct":
      return { op: "count_distinct", values: new Set<string>() };
    case "sum":
      return { op: "sum", value: 0 };
    case "avg":
      return { op: "avg", sum: 0, count: 0 };
    case "min":
      return { op: "min", value: null };
    case "max":
      return { op: "max", value: null };
    case "first":
      return { op: "first", seen: false, value: null };
    case "last":
      return { op: "last", value: null };
    case "median":
    case "variance":
    case "stddev":
      return { op: aggregate.op, values: [] };
  }
}

function applyAggregate(state: AggregateState, aggregate: ExecutableAggregateSpec, row: DataRow): AggregateState {
  const value = "expr" in aggregate ? evaluateRowExpr(aggregate.expr, row) : null;
  const numericValue = toFiniteNumberOrNull(value);
  switch (state.op) {
    case "count":
      return { ...state, value: state.value + 1 };
    case "null_count":
      return { ...state, value: state.value + (isNullish(value) ? 1 : 0) };
    case "count_distinct":
      if (!isNullish(value)) {
        state.values.add(JSON.stringify(value));
      }
      return state;
    case "sum":
      return { ...state, value: state.value + (numericValue ?? 0) };
    case "avg":
      return numericValue === null ? state : { ...state, sum: state.sum + numericValue, count: state.count + 1 };
    case "min":
      if (numericValue === null) {
        return state;
      }
      return { ...state, value: state.value === null ? numericValue : Math.min(state.value, numericValue) };
    case "max":
      if (numericValue === null) {
        return state;
      }
      return { ...state, value: state.value === null ? numericValue : Math.max(state.value, numericValue) };
    case "first":
      return state.seen ? state : { ...state, seen: true, value };
    case "last":
      return { ...state, value };
    case "median":
    case "variance":
    case "stddev":
      if (numericValue !== null) {
        state.values.push(numericValue);
      }
      return state;
  }
}

function finalizeMeasures(measures: Record<string, AggregateState>): DataRow {
  return Object.fromEntries(Object.entries(measures).map(([name, state]) => [name, finalizeAggregate(state)]));
}

function finalizeAggregate(state: AggregateState): PrimitiveValue {
  switch (state.op) {
    case "count":
    case "null_count":
      return state.value;
    case "count_distinct":
      return state.values.size;
    case "sum":
      return state.value;
    case "avg":
      return state.count ? state.sum / state.count : 0;
    case "min":
    case "max":
      return state.value;
    case "first":
    case "last":
      return state.value;
    case "median":
      return median(state.values);
    case "variance":
      return variance(state.values);
    case "stddev":
      return Math.sqrt(variance(state.values));
  }
}

function sortRows(rows: DataRow[], sort: QueryPlan["sort"]): DataRow[] {
  if (!sort?.length) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const clause of sort) {
      const comparison = comparePrimitive(left[clause.field], right[clause.field]);
      if (comparison !== 0) {
        return clause.direction === "desc" ? -comparison : comparison;
      }
    }
    return 0;
  });
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function variance(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function comparePrimitive(left: PrimitiveValue, right: PrimitiveValue): number {
  const leftNumber = toFiniteNumberOrNull(left);
  const rightNumber = toFiniteNumberOrNull(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function toNumber(value: PrimitiveValue): number {
  const numeric = toFiniteNumberOrNull(value);
  return numeric ?? 0;
}

function toFiniteNumberOrNull(value: PrimitiveValue): number | null {
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNullish(value: PrimitiveValue): boolean {
  return value === null || value === "";
}
