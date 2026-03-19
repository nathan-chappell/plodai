import ClientToolsWorker from "./client-tools.worker?worker";
import { renderChartToDataUrl } from "./chart";
import {
  appendWorkspaceReportItems,
  buildWorkspaceBootstrapMetadata,
  readWorkspaceAppState,
  readWorkspaceReportIndex,
  removeWorkspacePath,
  replaceWorkspaceReportItems,
  updateWorkspaceAppState,
  writeWorkspaceIndex,
  writeWorkspaceReport,
  writeWorkspaceReportIndex,
  writeWorkspaceTextFile,
} from "./workspace-contract";
import { addWorkspaceFilesAtPathsWithResult, getWorkspaceContext } from "./workspace-fs";
import { findWorkspaceFile } from "./workspace-files";

import type { CapabilityWorkspaceContext } from "../capabilities/types";
import type { ClientEffect, ClientToolArgsMap, ClientToolName } from "../types/analysis";
import type { LocalOtherFile } from "../types/report";
import type { ToolExecutionRequestV1, ToolExecutionResultV1, WorkspaceSnapshotV1 } from "../types/tool-runtime";
import { WORKSPACE_CHART_ARTIFACTS_DIR } from "../types/workspace-contract";

type PendingRequest = {
  resolve: (value: ToolExecutionResultV1) => void;
  reject: (error: Error) => void;
};

type ClientToolWorkerFactory = () => Worker;

let worker: Worker | null = null;
let nextRequestId = 1;
let commitChain = Promise.resolve();
const pendingRequests = new Map<number, PendingRequest>();
let workerFactory: ClientToolWorkerFactory = () => new ClientToolsWorker();

function rejectPendingRequests(error: Error): void {
  for (const [requestId, pending] of pendingRequests.entries()) {
    pending.reject(error);
    pendingRequests.delete(requestId);
  }
}

function disposeWorker(): void {
  worker?.terminate();
  worker = null;
}

export function resetClientToolBroker(): void {
  disposeWorker();
  rejectPendingRequests(new Error("Client tool broker was reset."));
  nextRequestId = 1;
  commitChain = Promise.resolve();
}

export function setClientToolWorkerFactoryForTests(
  factory: ClientToolWorkerFactory | null,
): void {
  resetClientToolBroker();
  workerFactory = factory ?? (() => new ClientToolsWorker());
}

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = workerFactory();
  worker.onmessage = (event: MessageEvent<ToolExecutionResultV1>) => {
    const pending = pendingRequests.get(event.data.request_id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(event.data.request_id);
    pending.resolve(event.data);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Client tool worker failed.");
    for (const [requestId, pending] of pendingRequests.entries()) {
      pending.reject(error);
      pendingRequests.delete(requestId);
    }
  };
  return worker;
}

function buildSnapshot(workspace: CapabilityWorkspaceContext): WorkspaceSnapshotV1 {
  const state = workspace.getState();
  return {
    version: "v1",
    filesystem: state.filesystem,
    path_prefix: state.activePrefix,
    workspace_context: state.workspaceContext,
    bootstrap: buildWorkspaceBootstrapMetadata(state.filesystem),
  };
}

async function applyMutations(
  workspace: CapabilityWorkspaceContext,
  result: ToolExecutionResultV1,
): Promise<ToolExecutionResultV1> {
  const chartEffects: ClientEffect[] = [];
  const chartWarnings: string[] = [];

  workspace.updateFilesystem((filesystem) => {
    let nextFilesystem = filesystem;

    for (const mutation of result.mutations) {
      switch (mutation.type) {
        case "write_text_file":
          nextFilesystem = writeWorkspaceTextFile(
            nextFilesystem,
            mutation.path,
            mutation.text,
            mutation.source,
          );
          break;
        case "delete_path":
          nextFilesystem = removeWorkspacePath(nextFilesystem, mutation.path);
          break;
        case "upsert_workspace_files":
          nextFilesystem = addWorkspaceFilesAtPathsWithResult(nextFilesystem, mutation.files).filesystem;
          break;
        case "upsert_report":
          nextFilesystem = writeWorkspaceReport(nextFilesystem, mutation.report);
          break;
        case "update_report_index":
          nextFilesystem = writeWorkspaceReportIndex(nextFilesystem, {
            version: "v1",
            report_ids: mutation.report_ids,
            current_report_id: mutation.current_report_id,
          });
          nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
            current_report_id: mutation.current_report_id,
          });
          nextFilesystem = writeWorkspaceIndex(
            nextFilesystem,
            {
              version: "v1",
              reserved_paths: [],
              report_ids: mutation.report_ids,
              current_report_id: mutation.current_report_id,
            },
          );
          break;
        case "replace_report_items":
          nextFilesystem = replaceWorkspaceReportItems(
            nextFilesystem,
            mutation.report_id,
            mutation.items,
          );
          break;
        case "append_report_items":
          nextFilesystem = appendWorkspaceReportItems(nextFilesystem, mutation.report_id, mutation.items);
          break;
        case "update_app_state":
          nextFilesystem = updateWorkspaceAppState(nextFilesystem, mutation.patch as never);
          break;
        case "render_chart_artifact":
          break;
      }
    }
    return nextFilesystem;
  });

  for (const mutation of result.mutations) {
    if (mutation.type !== "render_chart_artifact") {
      continue;
    }
    const state = workspace.getState();
    const file = findWorkspaceFile(state.files, mutation.file_id);
    if (file.kind !== "csv" && file.kind !== "json") {
      chartWarnings.push(`Unable to render chart artifact for ${mutation.file_id}.`);
      continue;
    }
    let imageDataUrl: string | null = null;
    try {
      imageDataUrl = await renderChartToDataUrl(mutation.chart as never, file.rows);
    } catch (error) {
      chartWarnings.push(
        `Unable to render chart artifact for ${mutation.file_id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    const artifact: LocalOtherFile = {
      id: crypto.randomUUID(),
      name: mutation.artifact_path.split("/").filter(Boolean).at(-1) ?? `${mutation.chart_plan_id}.json`,
      kind: "other",
      extension: "json",
      mime_type: "application/json",
      byte_size: 0,
      text_content: JSON.stringify(
        {
          version: "v1",
          chart_plan_id: mutation.chart_plan_id,
          file_id: mutation.file_id,
          title: mutation.title,
          chart: mutation.chart,
          image_data_url: imageDataUrl,
        },
        null,
        2,
      ),
    };
    artifact.byte_size = new TextEncoder().encode(artifact.text_content ?? "").length;
    const chartEffect: ClientEffect = {
      type: "chart_rendered",
      fileId: mutation.file_id,
      chartPlanId: mutation.chart_plan_id,
      chart: mutation.chart as never,
      imageDataUrl: imageDataUrl ?? undefined,
      rows: file.rows,
    };
    chartEffects.push(chartEffect);

    workspace.updateFilesystem((filesystem) => {
      const nextFilesystem = addWorkspaceFilesAtPathsWithResult(
        filesystem,
        [{ path: mutation.artifact_path, file: artifact, source: "derived" }],
      ).filesystem;
      return nextFilesystem;
    });
  }

  const state = workspace.getState();
  return {
    ...result,
    payload: {
      ...result.payload,
      imageDataUrl:
        chartEffects.find((effect) => effect.type === "chart_rendered")?.imageDataUrl ??
        result.payload.imageDataUrl ??
        null,
      workspace_context: getWorkspaceContext(state.filesystem, state.activePrefix),
      path_prefix: state.activePrefix,
      artifact_prefix: WORKSPACE_CHART_ARTIFACTS_DIR,
    },
    effects: [...result.effects, ...chartEffects],
    warnings: [...result.warnings, ...chartWarnings],
  };
}

export async function executeToolWithBroker<Name extends ClientToolName>(
  workspace: CapabilityWorkspaceContext,
  toolName: Name,
  args: ClientToolArgsMap[Name],
): Promise<ToolExecutionResultV1> {
  const activeWorker = getWorker();
  const request: ToolExecutionRequestV1<Name> = {
    version: "v1",
    request_id: nextRequestId++,
    tool_name: toolName,
    arguments: args,
    snapshot: buildSnapshot(workspace),
  };
  const workerResult = await new Promise<ToolExecutionResultV1>((resolve, reject) => {
    pendingRequests.set(request.request_id, { resolve, reject });
    activeWorker.postMessage(request);
  });
  const committedResult = commitChain.then(() => applyMutations(workspace, workerResult));
  commitChain = committedResult.then(
    () => undefined,
    () => undefined,
  );
  return committedResult;
}
