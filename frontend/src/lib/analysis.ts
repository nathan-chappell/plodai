import type { AnalysisPlan, DataExpression, DataRow, GroupingSpec, MeasureSpec, PrimitiveValue } from "../types/analysis";

export type AnalysisResult = {
  rows: DataRow[];
};

export function executeAnalysisPlan(rows: DataRow[], plan: AnalysisPlan): AnalysisResult {
  const filtered = plan.filter ? rows.filter((row) => Boolean(evaluateExpression(plan.filter!, row))) : rows;
  const grouped = plan.groupBy?.length ? groupRows(filtered, plan.groupBy, plan.measures) : reduceRows(filtered, plan.measures);
  const sorted = sortRows(grouped, plan.sort);
  const limited = typeof plan.limit === "number" ? sorted.slice(0, plan.limit) : sorted;
  return { rows: limited };
}

export function evaluateExpression(expression: DataExpression, row: DataRow): PrimitiveValue {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "field":
      return row[expression.field] ?? null;
    case "unary": {
      const value = evaluateExpression(expression.value, row);
      if (expression.op === "negate") {
        return -toNumber(value);
      }
      return !Boolean(value);
    }
    case "binary": {
      const left = evaluateExpression(expression.left, row);
      const right = evaluateExpression(expression.right, row);
      switch (expression.op) {
        case "add":
          return toNumber(left) + toNumber(right);
        case "subtract":
          return toNumber(left) - toNumber(right);
        case "multiply":
          return toNumber(left) * toNumber(right);
        case "divide":
          return toNumber(right) === 0 ? 0 : toNumber(left) / toNumber(right);
        case "mod":
          return toNumber(right) === 0 ? 0 : toNumber(left) % toNumber(right);
        case "eq":
          return left === right;
        case "neq":
          return left !== right;
        case "gt":
          return toNumber(left) > toNumber(right);
        case "gte":
          return toNumber(left) >= toNumber(right);
        case "lt":
          return toNumber(left) < toNumber(right);
        case "lte":
          return toNumber(left) <= toNumber(right);
        case "and":
          return Boolean(left) && Boolean(right);
        case "or":
          return Boolean(left) || Boolean(right);
      }
    }
  }
}

function groupRows(rows: DataRow[], groupBy: GroupingSpec[], measures: MeasureSpec[]): DataRow[] {
  const buckets = new Map<string, { keys: DataRow; rows: DataRow[] }>();

  for (const row of rows) {
    const keyRecord = Object.fromEntries(groupBy.map((group) => [group.as, evaluateExpression(group.expr, row)]));
    const key = JSON.stringify(keyRecord);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.rows.push(row);
      continue;
    }
    buckets.set(key, { keys: keyRecord, rows: [row] });
  }

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket.keys,
    ...computeMeasures(bucket.rows, measures),
  }));
}

function reduceRows(rows: DataRow[], measures: MeasureSpec[]): DataRow[] {
  return [{ ...computeMeasures(rows, measures) }];
}

function computeMeasures(rows: DataRow[], measures: MeasureSpec[]): DataRow {
  return Object.fromEntries(measures.map((measure) => [measure.as, reduceMeasure(rows, measure)]));
}

function reduceMeasure(rows: DataRow[], measure: MeasureSpec): PrimitiveValue {
  const values = rows.map((row) => (measure.expr ? evaluateExpression(measure.expr, row) : 1));
  switch (measure.op) {
    case "count":
      return rows.length;
    case "sum":
      return values.reduce((total, value) => total + toNumber(value), 0);
    case "avg":
      return values.length ? values.reduce((total, value) => total + toNumber(value), 0) / values.length : 0;
    case "min":
      return values.length ? Math.min(...values.map(toNumber)) : 0;
    case "max":
      return values.length ? Math.max(...values.map(toNumber)) : 0;
    case "first":
      return values[0] ?? null;
  }
}

function sortRows(rows: DataRow[], sort: AnalysisPlan["sort"]): DataRow[] {
  if (!sort?.length) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const clause of sort) {
      const leftValue = left[clause.field];
      const rightValue = right[clause.field];
      if (leftValue === rightValue) {
        continue;
      }
      const comparison = compareValues(leftValue, rightValue);
      return clause.direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

function compareValues(left: PrimitiveValue, right: PrimitiveValue): number {
  if (typeof left === "number" || typeof right === "number") {
    return toNumber(left) - toNumber(right);
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function toNumber(value: PrimitiveValue): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
