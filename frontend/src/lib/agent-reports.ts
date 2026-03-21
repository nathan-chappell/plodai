import { buildReportResource, normalizeAgentShellState, removeAgentResource, upsertAgentResource } from "./shell-resources";
import type { AgentShellState } from "../types/shell";
import type { ReportSlideV1, WorkspaceReportV1 } from "../types/workspace-contract";
import { buildDefaultWorkspaceReport, normalizeReportId } from "../types/workspace-contract";

function nowIso(): string {
  return new Date().toISOString();
}

export function listReports(state: AgentShellState): WorkspaceReportV1[] {
  return normalizeAgentShellState(state).resources
    .flatMap((resource) =>
      resource.kind === "report" && resource.payload.type === "report"
        ? [resource.payload.report]
        : [],
    )
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function getReport(
  state: AgentShellState,
  reportId: string,
): WorkspaceReportV1 | null {
  const normalizedReportId = normalizeReportId(reportId);
  return (
    listReports(state).find((report) => report.report_id === normalizedReportId) ?? null
  );
}

export function upsertReport(
  state: AgentShellState,
  ownerAgentId: string,
  report: WorkspaceReportV1,
): AgentShellState {
  return upsertAgentResource(state, buildReportResource(ownerAgentId, report));
}

export function createReport(
  state: AgentShellState,
  ownerAgentId: string,
  options: {
    title: string;
    reportId?: string;
  },
): { state: AgentShellState; report: WorkspaceReportV1 } {
  const existingIds = new Set(listReports(state).map((report) => report.report_id));
  const baseId = normalizeReportId(options.reportId ?? options.title ?? "report");
  let nextId = baseId;
  let counter = 2;
  while (existingIds.has(nextId)) {
    nextId = `${baseId}-${counter}`;
    counter += 1;
  }
  const report = buildDefaultWorkspaceReport({
    reportId: nextId,
    title: options.title,
  });
  const nextState = upsertReport(
    {
      ...normalizeAgentShellState(state),
      current_report_id: report.report_id,
    },
    ownerAgentId,
    report,
  );
  return {
    state: {
      ...nextState,
      current_report_id: report.report_id,
    },
    report,
  };
}

export function setCurrentReportId(
  state: AgentShellState,
  reportId: string,
): AgentShellState {
  const normalized = normalizeReportId(reportId);
  if (!getReport(state, normalized)) {
    return state;
  }
  return {
    ...normalizeAgentShellState(state),
    current_report_id: normalized,
  };
}

export function appendReportSlides(
  state: AgentShellState,
  ownerAgentId: string,
  reportId: string,
  slides: ReportSlideV1[],
): AgentShellState {
  if (!slides.length) {
    return state;
  }
  const normalizedReportId = normalizeReportId(reportId);
  const current =
    getReport(state, normalizedReportId) ??
    buildDefaultWorkspaceReport({ reportId: normalizedReportId });
  return upsertReport(
    {
      ...normalizeAgentShellState(state),
      current_report_id: normalizedReportId,
    },
    ownerAgentId,
    {
      ...current,
      slides: [...current.slides, ...slides],
      updated_at: nowIso(),
    },
  );
}

export function removeReportSlide(
  state: AgentShellState,
  ownerAgentId: string,
  reportId: string,
  slideId: string,
): AgentShellState {
  const normalizedReportId = normalizeReportId(reportId);
  const current = getReport(state, normalizedReportId);
  if (!current) {
    return state;
  }
  return upsertReport(
    {
      ...normalizeAgentShellState(state),
      current_report_id: normalizedReportId,
    },
    ownerAgentId,
    {
      ...current,
      slides: current.slides.filter((slide) => slide.id !== slideId),
      updated_at: nowIso(),
    },
  );
}

export function replaceReportSlides(
  state: AgentShellState,
  ownerAgentId: string,
  reportId: string,
  slides: ReportSlideV1[],
): AgentShellState {
  const normalizedReportId = normalizeReportId(reportId);
  const current =
    getReport(state, normalizedReportId) ??
    buildDefaultWorkspaceReport({ reportId: normalizedReportId });
  return upsertReport(
    {
      ...normalizeAgentShellState(state),
      current_report_id: normalizedReportId,
    },
    ownerAgentId,
    {
      ...current,
      slides,
      updated_at: nowIso(),
    },
  );
}

export function removeReport(
  state: AgentShellState,
  reportId: string,
): AgentShellState {
  return removeAgentResource(state, normalizeReportId(reportId));
}
