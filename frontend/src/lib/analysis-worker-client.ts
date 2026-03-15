import AnalysisWorker from "./analysis.worker?worker";

import type { DataRow, QueryPlan } from "../types/analysis";

type PendingRequest = {
  resolve: (rows: DataRow[]) => void;
  reject: (error: Error) => void;
};

type WorkerRequest = {
  id: number;
  rows: DataRow[];
  plan: QueryPlan;
};

type WorkerResponse = {
  id: number;
  rows: DataRow[];
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new AnalysisWorker();
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(event.data.id);
    pending.resolve(event.data.rows);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Analysis worker failed.");
    for (const [id, pending] of pendingRequests.entries()) {
      pending.reject(error);
      pendingRequests.delete(id);
    }
  };

  return worker;
}

export function executeQueryPlanInWorker(rows: DataRow[], plan: QueryPlan): Promise<DataRow[]> {
  const activeWorker = getWorker();
  const id = nextRequestId++;

  return new Promise<DataRow[]>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    const request: WorkerRequest = { id, rows, plan };
    activeWorker.postMessage(request);
  });
}
