import ClientToolsWorker from "./client-tools.worker?worker";
import { renderChartToDataUrl } from "./chart";
import {
  appendWorkspaceReportItems,
  buildWorkspaceBootstrapMetadata,
  readWorkspaceAppState,
  readWorkspaceReportIndex,
  replaceWorkspaceReportItems,
  updateWorkspaceAppState,
  writeWorkspaceTextFile,
} from "./workspace-contract";
import { addWorkspaceFilesWithResult, ensureDirectoryPath, getDirectoryByPath, getWorkspaceContext, resolveWorkspacePath } from "./workspace-fs";
import { findWorkspaceFile } from "./workspace-files";

import type {
  CapabilityWorkspaceContext,
} from "../capabilities/types";
import type { ClientEffect, ClientToolArgsMap, ClientToolName } from "../types/analysis";
import type { LocalOtherFile, LocalWorkspaceFile } from "../types/report";
import type { ToolExecutionRequestV1, ToolExecutionResultV1, VfsMutationV1, WorkspaceSnapshotV1 } from "../types/tool-runtime";
import type { ReportItemV1 } from "../types/workspace-contract";
import { WORKSPACE_CHART_ARTIFACTS_DIR } from "../types/workspace-contract";

type PendingRequest = {
  resolve: (value: ToolExecutionResultV1) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
let commitChain = Promise.resolve();
const pendingRequests = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new ClientToolsWorker();
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
    cwd_path: state.cwdPath,
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
    let cwdPath = workspace.getState().cwdPath;

    for (const mutation of result.mutations) {
      switch (mutation.type) {
        case "mkdir":
          nextFilesystem = ensureDirectoryPath(nextFilesystem, mutation.path).filesystem;
          break;
        case "write_text_file":
          nextFilesystem = writeWorkspaceTextFile(
            nextFilesystem,
            mutation.path,
            mutation.text,
            mutation.source,
          );
          break;
        case "delete_path":
          break;
        case "append_workspace_files":
          nextFilesystem = addWorkspaceFilesWithResult(
            nextFilesystem,
            mutation.directory_path,
            mutation.files,
            mutation.source,
          ).filesystem;
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
        case "change_directory":
          cwdPath = getDirectoryByPath(
            nextFilesystem,
            resolveWorkspacePath(mutation.path, cwdPath),
          ).path;
          nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
            current_cwd_by_surface: {
              [workspace.cwdPath.split("/").filter(Boolean)[0] ?? "workspace"]: cwdPath,
            },
          });
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
    const imageDataUrl = await renderChartToDataUrl(mutation.chart as never, file.rows);
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
      let nextFilesystem = addWorkspaceFilesWithResult(
        filesystem,
        WORKSPACE_CHART_ARTIFACTS_DIR,
        [artifact],
        "derived",
      ).filesystem;
      const reportId =
        readWorkspaceAppState(nextFilesystem)?.current_report_id ??
        readWorkspaceReportIndex(nextFilesystem)?.current_report_id;
      if (reportId) {
        const reportItems: ReportItemV1[] = [
          {
            id: crypto.randomUUID(),
            type: "chart",
            created_at: new Date().toISOString(),
            title: mutation.title,
            file_id: mutation.file_id,
            chart_plan_id: mutation.chart_plan_id,
            chart: mutation.chart,
            image_data_url: imageDataUrl ?? null,
          },
        ];
        nextFilesystem = appendWorkspaceReportItems(nextFilesystem, reportId, reportItems);
      }
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
      workspace_context: getWorkspaceContext(state.filesystem, state.cwdPath),
      files: state.filesystem.items
        .filter((item): item is typeof item & { kind: "file" } => item.kind === "file")
        .map((item) => ({
          id: item.file.id,
          name: item.file.name,
          kind: item.file.kind,
          path: item.path,
          extension: item.file.extension,
          mime_type: item.file.mime_type,
          byte_size: item.file.byte_size,
        })),
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
