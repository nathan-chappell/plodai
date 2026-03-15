import type { AggregateSpec, DataRow, PrimitiveValue, ProjectField, QueryPlan, RowExpr } from "../types/analysis";

export type AnalysisResult = {
  rows: DataRow[];
};

type ExecutableAggregateSpec = Exclude<AggregateSpec, { op: "describe_numeric" }>;
type RowEvaluator = (row: DataRow) => PrimitiveValue;
type SortAccessor = {
  field: string;
  direction: "asc" | "desc";
};

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

type CompiledAggregate = {
  as: string;
  stateFactory: () => AggregateState;
  apply: (state: AggregateState, row: DataRow) => void;
};

type CompiledPlan = {
  where?: (row: DataRow) => boolean;
  project?: (row: DataRow) => DataRow;
  aggregate?: (rows: DataRow[]) => DataRow[];
  sort?: SortAccessor[];
  limit?: number;
};

export function executeQueryPlan(rows: DataRow[], plan: QueryPlan): AnalysisResult {
  const compiled = compilePlan(plan);
  const filtered = compiled.where ? rows.filter(compiled.where) : rows;

  if (compiled.aggregate) {
    const grouped = compiled.aggregate(filtered);
    const sorted = sortRows(grouped, compiled.sort);
    return { rows: applyLimit(sorted, compiled.limit) };
  }

  const projected = compiled.project ? filtered.map(compiled.project) : filtered;
  const sorted = sortRows(projected, compiled.sort);
  return { rows: applyLimit(sorted, compiled.limit) };
}

export function evaluateRowExpr(expression: RowExpr, row: DataRow): PrimitiveValue {
  return compileRowExpr(expression)(row);
}

function compilePlan(plan: QueryPlan): CompiledPlan {
  const whereEvaluator = plan.where ? compileTruthyExpr(plan.where) : undefined;
  const projectEvaluator = plan.project?.length ? compileProject(plan.project as ProjectField[]) : undefined;
  const aggregateEvaluator = plan.aggregates?.length ? compileAggregatePlan(plan) : undefined;

  return {
    where: whereEvaluator,
    project: projectEvaluator,
    aggregate: aggregateEvaluator,
    sort: plan.sort ?? undefined,
    limit: typeof plan.limit === "number" ? plan.limit : undefined,
  };
}

function compileTruthyExpr(expression: RowExpr): (row: DataRow) => boolean {
  const evaluator = compileRowExpr(expression);
  return (row) => Boolean(evaluator(row));
}

function compileProject(project: ProjectField[]): (row: DataRow) => DataRow {
  const fields = project.map((field) => ({
    as: field.as,
    evaluate: compileRowExpr(field.expr),
  }));

  return (row) => {
    const projected: DataRow = {};
    for (const field of fields) {
      projected[field.as] = field.evaluate(row);
    }
    return projected;
  };
}

function compileAggregatePlan(plan: QueryPlan): (rows: DataRow[]) => DataRow[] {
  const groupBy = (plan.group_by ?? []).map((key) => ({
    as: key.as,
    evaluate: compileRowExpr(key.expr),
  }));
  const aggregates = compileAggregates(expandAggregateSpecs(plan.aggregates ?? []));

  return (rows) => {
    const groups: Record<string, GroupState> = {};

    for (const row of rows) {
      const keyValues: DataRow = {};
      for (const key of groupBy) {
        keyValues[key.as] = key.evaluate(row);
      }
      const groupKey = JSON.stringify(keyValues);
      let group = groups[groupKey];
      if (!group) {
        group = {
          keys: keyValues,
          measures: initializeMeasures(aggregates),
        };
        groups[groupKey] = group;
      }

      for (const aggregate of aggregates) {
        aggregate.apply(group.measures[aggregate.as], row);
      }
    }

    return Object.values(groups).map((group) => ({
      ...group.keys,
      ...finalizeMeasures(group.measures),
    }));
  };
}

function compileAggregates(aggregates: ExecutableAggregateSpec[]): CompiledAggregate[] {
  return aggregates.map((aggregate) => {
    const evaluate = "expr" in aggregate ? compileRowExpr(aggregate.expr) : null;

    switch (aggregate.op) {
      case "count":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "count", value: 0 }),
          apply: (state) => {
            (state as Extract<AggregateState, { op: "count" }>).value += 1;
          },
        };
      case "null_count":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "null_count", value: 0 }),
          apply: (state, row) => {
            const typedState = state as Extract<AggregateState, { op: "null_count" }>;
            if (isNullish((evaluate as RowEvaluator)(row))) {
              typedState.value += 1;
            }
          },
        };
      case "count_distinct":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "count_distinct", values: new Set<string>() }),
          apply: (state, row) => {
            const value = (evaluate as RowEvaluator)(row);
            if (!isNullish(value)) {
              (state as Extract<AggregateState, { op: "count_distinct" }>).values.add(JSON.stringify(value));
            }
          },
        };
      case "sum":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "sum", value: 0 }),
          apply: (state, row) => {
            const numeric = toFiniteNumberOrNull((evaluate as RowEvaluator)(row));
            if (numeric !== null) {
              (state as Extract<AggregateState, { op: "sum" }>).value += numeric;
            }
          },
        };
      case "avg":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "avg", sum: 0, count: 0 }),
          apply: (state, row) => {
            const numeric = toFiniteNumberOrNull((evaluate as RowEvaluator)(row));
            if (numeric !== null) {
              const typedState = state as Extract<AggregateState, { op: "avg" }>;
              typedState.sum += numeric;
              typedState.count += 1;
            }
          },
        };
      case "min":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "min", value: null }),
          apply: (state, row) => {
            const numeric = toFiniteNumberOrNull((evaluate as RowEvaluator)(row));
            if (numeric !== null) {
              const typedState = state as Extract<AggregateState, { op: "min" }>;
              typedState.value = typedState.value === null ? numeric : Math.min(typedState.value, numeric);
            }
          },
        };
      case "max":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "max", value: null }),
          apply: (state, row) => {
            const numeric = toFiniteNumberOrNull((evaluate as RowEvaluator)(row));
            if (numeric !== null) {
              const typedState = state as Extract<AggregateState, { op: "max" }>;
              typedState.value = typedState.value === null ? numeric : Math.max(typedState.value, numeric);
            }
          },
        };
      case "first":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "first", seen: false, value: null }),
          apply: (state, row) => {
            const typedState = state as Extract<AggregateState, { op: "first" }>;
            if (!typedState.seen) {
              typedState.seen = true;
              typedState.value = (evaluate as RowEvaluator)(row);
            }
          },
        };
      case "last":
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op: "last", value: null }),
          apply: (state, row) => {
            (state as Extract<AggregateState, { op: "last" }>).value = (evaluate as RowEvaluator)(row);
          },
        };
      case "median":
      case "variance":
      case "stddev":
        {
          const op = aggregate.op;
        return {
          as: aggregate.as,
          stateFactory: (): AggregateState => ({ op, values: [] as number[] }),
          apply: (state, row) => {
            const numeric = toFiniteNumberOrNull((evaluate as RowEvaluator)(row));
            if (numeric !== null) {
              (state as Extract<AggregateState, { op: "median" | "variance" | "stddev" }>).values.push(numeric);
            }
          },
        };
        }
    }
  });
}

function compileRowExpr(expression: RowExpr): RowEvaluator {
  switch (expression.kind) {
    case "literal":
      return () => expression.value;
    case "column": {
      const { column } = expression;
      return (row) => row[column] ?? null;
    }
    case "unary": {
      const evaluateValue = compileRowExpr(expression.value);
      if (expression.op === "negate") {
        return (row) => -toNumber(evaluateValue(row));
      }
      return (row) => !Boolean(evaluateValue(row));
    }
    case "binary":
      return compileBinaryExpr(expression);
    case "call":
      return compileCallExpr(expression);
  }
}

function compileBinaryExpr(expression: Extract<RowExpr, { kind: "binary" }>): RowEvaluator {
  const left = compileRowExpr(expression.left);
  const right = compileRowExpr(expression.right);

  switch (expression.op) {
    case "add":
      return (row) => toNumber(left(row)) + toNumber(right(row));
    case "sub":
      return (row) => toNumber(left(row)) - toNumber(right(row));
    case "mul":
      return (row) => toNumber(left(row)) * toNumber(right(row));
    case "div":
      return (row) => {
        const rightValue = toNumber(right(row));
        return rightValue === 0 ? 0 : toNumber(left(row)) / rightValue;
      };
    case "mod":
      return (row) => {
        const rightValue = toNumber(right(row));
        return rightValue === 0 ? 0 : toNumber(left(row)) % rightValue;
      };
    case "eq":
      return (row) => left(row) === right(row);
    case "neq":
      return (row) => left(row) !== right(row);
    case "gt":
      return (row) => comparePrimitive(left(row), right(row)) > 0;
    case "gte":
      return (row) => comparePrimitive(left(row), right(row)) >= 0;
    case "lt":
      return (row) => comparePrimitive(left(row), right(row)) < 0;
    case "lte":
      return (row) => comparePrimitive(left(row), right(row)) <= 0;
    case "and":
      return (row) => Boolean(left(row)) && Boolean(right(row));
    case "or":
      return (row) => Boolean(left(row)) || Boolean(right(row));
  }
}

function compileCallExpr(expression: Extract<RowExpr, { kind: "call" }>): RowEvaluator {
  const args = expression.args.map(compileRowExpr);

  switch (expression.fn) {
    case "lower":
      return (row) => String(args[0]?.(row) ?? "").toLowerCase();
    case "upper":
      return (row) => String(args[0]?.(row) ?? "").toUpperCase();
    case "trim":
      return (row) => String(args[0]?.(row) ?? "").trim();
    case "abs":
      return (row) => Math.abs(toNumber(args[0]?.(row) ?? null));
    case "round":
      return (row) => Math.round(toNumber(args[0]?.(row) ?? null));
    case "floor":
      return (row) => Math.floor(toNumber(args[0]?.(row) ?? null));
    case "ceil":
      return (row) => Math.ceil(toNumber(args[0]?.(row) ?? null));
    case "coalesce":
      return (row) => {
        for (const evaluate of args) {
          const value = evaluate(row);
          if (value !== null && value !== "") {
            return value;
          }
        }
        return null;
      };
  }
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

function initializeMeasures(aggregates: CompiledAggregate[]): Record<string, AggregateState> {
  const measures: Record<string, AggregateState> = {};
  for (const aggregate of aggregates) {
    measures[aggregate.as] = aggregate.stateFactory();
  }
  return measures;
}

function finalizeMeasures(measures: Record<string, AggregateState>): DataRow {
  const finalized: DataRow = {};
  for (const [name, state] of Object.entries(measures)) {
    finalized[name] = finalizeAggregate(state);
  }
  return finalized;
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

function sortRows(rows: DataRow[], sort: QueryPlan["sort"] | SortAccessor[] | undefined): DataRow[] {
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

function applyLimit(rows: DataRow[], limit: number | undefined): DataRow[] {
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
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
  let total = 0;
  for (const value of values) {
    total += value;
  }
  const mean = total / values.length;
  let squaredDeviationTotal = 0;
  for (const value of values) {
    squaredDeviationTotal += (value - mean) ** 2;
  }
  return squaredDeviationTotal / values.length;
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
