import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  buildWorkspaceBootstrapMetadata,
  ensureWorkspaceContractFilesystem,
  listWorkspaceReports,
  readWorkspaceAppState,
  readWorkspaceReport,
  readWorkspaceReportIndex,
  setWorkspaceCurrentReport,
  syncWorkspaceToolCatalog,
  updateWorkspaceAppState,
  updateWorkspaceCurrentGoal,
} from "../../lib/workspace-contract";
import type { CapabilityWorkspaceSnapshot } from "../../lib/workspace-store";
import type { ExecutionMode, WorkspaceStateReportSummary } from "../../types/analysis";
import type { WorkspaceBootstrapMetadata, WorkspaceReportV1 } from "../../types/workspace-contract";
import type { CapabilityWorkspaceContext } from "../types";

type ContractUiState = {
  ready: boolean;
  migrated: boolean;
};

type ContractAction =
  | { type: "ready" }
  | { type: "migrated" };

function normalizeWorkspaceTab(
  tab: string | null | undefined,
  allowedTabs: string[],
  defaultTab: string,
): string {
  return tab && allowedTabs.includes(tab) ? tab : defaultTab;
}

function reducer(state: ContractUiState, action: ContractAction): ContractUiState {
  switch (action.type) {
    case "ready":
      return { ...state, ready: true };
    case "migrated":
      return { ...state, ready: true, migrated: true };
  }
}

function migrateLegacySnapshot(
  workspace: CapabilityWorkspaceContext,
  options: {
    capabilityId: string;
    capabilityTitle: string;
    defaultGoal: string;
    defaultTab: string;
    allowedTabs: string[];
    defaultExecutionMode: ExecutionMode;
    toolNames?: string[];
    legacySnapshot: CapabilityWorkspaceSnapshot | null;
  },
) {
  workspace.updateFilesystem((currentFilesystem) => {
    let nextFilesystem = ensureWorkspaceContractFilesystem(currentFilesystem, {
      capabilityId: options.capabilityId,
      capabilityTitle: options.capabilityTitle,
      defaultGoal: options.defaultGoal,
      activeWorkspaceTab: options.defaultTab,
      executionMode: options.defaultExecutionMode,
      toolNames: options.toolNames ?? [],
      prefixBySurface: { [options.capabilityId]: workspace.activePrefix },
    });

    const legacy = options.legacySnapshot;
    if (legacy) {
      const appState = readWorkspaceAppState(nextFilesystem);

      if (legacy.investigationBrief && !appState?.current_goal) {
        nextFilesystem = updateWorkspaceCurrentGoal(nextFilesystem, legacy.investigationBrief);
      }
      const legacyWorkspaceTab = normalizeWorkspaceTab(
        legacy.activeWorkspaceTab,
        options.allowedTabs,
        options.defaultTab,
      );
      if (legacyWorkspaceTab && appState?.active_workspace_tab !== legacyWorkspaceTab) {
        nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
          active_workspace_tab: legacyWorkspaceTab,
        });
      }
      if (legacy.executionMode && appState?.execution_mode !== legacy.executionMode) {
        nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
          execution_mode: legacy.executionMode,
        });
      }
    }

    nextFilesystem = syncWorkspaceToolCatalog(
      nextFilesystem,
      options.capabilityId,
      options.toolNames ?? [],
    );
    return nextFilesystem;
  });
}

export function useWorkspaceContract(options: {
  workspace: CapabilityWorkspaceContext;
  capabilityId: string;
  capabilityTitle: string;
  defaultGoal: string;
  defaultTab: string;
  allowedTabs: string[];
  defaultExecutionMode: ExecutionMode;
  toolNames?: string[];
  legacySnapshot: CapabilityWorkspaceSnapshot | null;
}) {
  const [uiState, dispatch] = useReducer(reducer, {
    ready: false,
    migrated: false,
  });

  const filesystem = options.workspace.getState().filesystem;
  const allowedTabsKey = options.allowedTabs.join("|");
  const toolNamesKey = (options.toolNames ?? []).join("|");

  useEffect(() => {
    migrateLegacySnapshot(options.workspace, options);
    dispatch({ type: options.legacySnapshot ? "migrated" : "ready" });
  }, [
    options.capabilityId,
    options.capabilityTitle,
    options.defaultExecutionMode,
    options.defaultGoal,
    options.defaultTab,
    allowedTabsKey,
    options.legacySnapshot,
    options.workspace.activePrefix,
    options.workspace.updateFilesystem,
    toolNamesKey,
  ]);

  const appState = useMemo(
    () => readWorkspaceAppState(filesystem),
    [filesystem],
  );
  const reportIndex = useMemo(
    () => readWorkspaceReportIndex(filesystem),
    [filesystem],
  );
  const currentReport = useMemo<WorkspaceReportV1 | null>(() => {
    const reportId = appState?.current_report_id ?? reportIndex?.current_report_id;
    return reportId ? readWorkspaceReport(filesystem, reportId) : null;
  }, [appState, filesystem, reportIndex]);
  const reports = useMemo(() => listWorkspaceReports(filesystem), [filesystem]);
  const reportSummaries = useMemo<WorkspaceStateReportSummary[]>(
    () =>
      reports.map((report) => ({
        report_id: report.report_id,
        title: report.title,
        item_count: report.slides.length,
        slide_count: report.slides.length,
        updated_at: report.updated_at ?? null,
      })),
    [reports],
  );
  const bootstrapMetadata = useMemo<WorkspaceBootstrapMetadata>(
    () => buildWorkspaceBootstrapMetadata(filesystem),
    [filesystem],
  );

  const setInvestigationBrief = useCallback((value: string) => {
    options.workspace.updateFilesystem((filesystem) => updateWorkspaceCurrentGoal(filesystem, value));
  }, [options.workspace.updateFilesystem]);

  const setActiveWorkspaceTab = useCallback((nextTab: string) => {
    options.workspace.updateFilesystem((filesystem) =>
      updateWorkspaceAppState(filesystem, { active_workspace_tab: nextTab }),
    );
  }, [options.workspace.updateFilesystem]);

  const setExecutionMode = useCallback((nextMode: ExecutionMode) => {
    options.workspace.updateFilesystem((filesystem) =>
      updateWorkspaceAppState(filesystem, { execution_mode: nextMode }),
    );
  }, [options.workspace.updateFilesystem]);

  const syncToolCatalog = useCallback((toolNames: string[]) => {
    options.workspace.updateFilesystem((filesystem) =>
      syncWorkspaceToolCatalog(filesystem, options.capabilityId, toolNames),
    );
  }, [options.capabilityId, options.workspace.updateFilesystem]);

  const selectCurrentReport = useCallback((reportId: string) => {
    options.workspace.updateFilesystem((filesystem) =>
      setWorkspaceCurrentReport(filesystem, reportId),
    );
  }, [options.workspace.updateFilesystem]);

  return {
    ready: uiState.ready,
    migrated: uiState.migrated,
    bootstrapMetadata,
    appState,
    reportIndex,
    reports,
    reportSummaries,
    currentReport,
    investigationBrief: appState?.current_goal ?? options.defaultGoal,
    setInvestigationBrief,
    activeWorkspaceTab: normalizeWorkspaceTab(
      appState?.active_workspace_tab,
      options.allowedTabs,
      options.defaultTab,
    ),
    setActiveWorkspaceTab,
    executionMode: appState?.execution_mode ?? options.defaultExecutionMode,
    setExecutionMode,
    syncToolCatalog,
    selectCurrentReport,
    currentReportId:
      appState?.current_report_id ?? reportIndex?.current_report_id ?? null,
    reportIds: reportIndex?.report_ids ?? [],
  };
}
