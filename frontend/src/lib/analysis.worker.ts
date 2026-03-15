import { executeQueryPlan } from "./analysis";

import type { DataRow, QueryPlan } from "../types/analysis";

type WorkerRequest = {
  id: number;
  rows: DataRow[];
  plan: QueryPlan;
};

type WorkerResponse = {
  id: number;
  rows: DataRow[];
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, rows, plan } = event.data;
  const result = executeQueryPlan(rows, plan);
  const response: WorkerResponse = {
    id,
    rows: result.rows,
  };
  self.postMessage(response);
};
