import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  appendWorkspaceReportItems,
  buildWorkspaceBootstrapMetadata,
  effectsToReportItems,
  ensureWorkspaceContractFilesystem,
  readWorkspaceAppState,
  readWorkspaceReport,
  readWorkspaceReportIndex,
  replaceWorkspaceReportItems,
  reportItemsToEffects,
  syncWorkspaceToolCatalog,
  updateWorkspaceAppState,
  updateWorkspaceCurrentGoal,
} from "../../lib/workspace-contract";
import type { CapabilityWorkspaceSnapshot } from "../../lib/workspace-store";
import type { ClientEffect, ExecutionMode } from "../../types/analysis";
import type { WorkspaceBootstrapMetadata, WorkspaceReportV1 } from "../../types/workspace-contract";
import type { CapabilityWorkspaceContext } from "../types";

type ContractUiState = {
  ready: boolean;
  migrated: boolean;
};

type ContractAction =
  | { type: "ready" }
  | { type: "migrated" };

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
      const reportIndex = readWorkspaceReportIndex(nextFilesystem);
      const reportId = appState?.current_report_id ?? reportIndex?.current_report_id;

      if (legacy.investigationBrief && !appState?.current_goal) {
        nextFilesystem = updateWorkspaceCurrentGoal(nextFilesystem, legacy.investigationBrief);
      }
      if (legacy.activeWorkspaceTab && appState?.active_workspace_tab !== legacy.activeWorkspaceTab) {
        nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
          active_workspace_tab: legacy.activeWorkspaceTab,
        });
      }
      if (legacy.executionMode && appState?.execution_mode !== legacy.executionMode) {
        nextFilesystem = updateWorkspaceAppState(nextFilesystem, {
          execution_mode: legacy.executionMode,
        });
      }
      if (reportId && legacy.reportEffects.length) {
        const currentReport = readWorkspaceReport(nextFilesystem, reportId);
        if (!currentReport?.items.length) {
          nextFilesystem = replaceWorkspaceReportItems(
            nextFilesystem,
            reportId,
            effectsToReportItems(legacy.reportEffects),
          );
        }
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
  defaultExecutionMode: ExecutionMode;
  toolNames?: string[];
  legacySnapshot: CapabilityWorkspaceSnapshot | null;
}) {
  const [uiState, dispatch] = useReducer(reducer, {
    ready: false,
    migrated: false,
  });

  const filesystem = options.workspace.getState().filesystem;
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
  const reportEffects = useMemo(
    () => reportItemsToEffects(currentReport?.items ?? []),
    [currentReport],
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

  const setReportEffects = useCallback((
    value: ClientEffect[] | ((current: ClientEffect[]) => ClientEffect[]),
  ) => {
    const currentEffects = reportItemsToEffects(currentReport?.items ?? []);
    const nextEffects = typeof value === "function" ? value(currentEffects) : value;
    const reportId =
      appState?.current_report_id ?? reportIndex?.current_report_id;
    if (!reportId) {
      return;
    }
    options.workspace.updateFilesystem((filesystem) =>
      replaceWorkspaceReportItems(filesystem, reportId, effectsToReportItems(nextEffects)),
    );
  }, [appState, currentReport, options.workspace.updateFilesystem, reportIndex]);

  const appendReportEffects = useCallback((effects: ClientEffect[]) => {
    if (!effects.length) {
      return;
    }
    const reportId =
      appState?.current_report_id ?? reportIndex?.current_report_id;
    if (!reportId) {
      return;
    }
    options.workspace.updateFilesystem((filesystem) =>
      appendWorkspaceReportItems(filesystem, reportId, effectsToReportItems(effects)),
    );
  }, [appState, options.workspace.updateFilesystem, reportIndex]);

  const syncToolCatalog = useCallback((toolNames: string[]) => {
    options.workspace.updateFilesystem((filesystem) =>
      syncWorkspaceToolCatalog(filesystem, options.capabilityId, toolNames),
    );
  }, [options.capabilityId, options.workspace.updateFilesystem]);

  return {
    ready: uiState.ready,
    migrated: uiState.migrated,
    bootstrapMetadata,
    appState,
    reportIndex,
    currentReport,
    investigationBrief: appState?.current_goal ?? options.defaultGoal,
    setInvestigationBrief,
    activeWorkspaceTab: appState?.active_workspace_tab ?? options.defaultTab,
    setActiveWorkspaceTab,
    executionMode: appState?.execution_mode ?? options.defaultExecutionMode,
    setExecutionMode,
    reportEffects,
    setReportEffects,
    appendReportEffects,
    syncToolCatalog,
    currentReportId:
      appState?.current_report_id ?? reportIndex?.current_report_id ?? null,
    reportIds: reportIndex?.report_ids ?? [],
  };
}
