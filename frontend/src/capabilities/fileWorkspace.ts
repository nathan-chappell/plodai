import { useCallback, useEffect, useState } from "react";

import { useAppState } from "../app/context";
import { useWorkspaceSurface } from "../app/workspace";
import { loadCapabilityWorkspace, type CapabilityWorkspaceSnapshot } from "../lib/workspace-store";
import type { ClientEffect, ExecutionMode } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import { useWorkspaceContract } from "./shared/useWorkspaceContract";
import { syncWorkspaceToolCatalog } from "../lib/workspace-contract";

export function useCapabilityFileWorkspace(options: {
  capabilityId: string;
  capabilityTitle: string;
  defaultStatus: string;
  defaultBrief: string;
  defaultTab: string;
  defaultExecutionMode?: ExecutionMode;
  allowedTabs: string[];
}) {
  const { user } = useAppState();
  const workspace = useWorkspaceSurface({
    surfaceKey: options.capabilityId,
    defaultCwdPath: `/${options.capabilityId}`,
  });
  const allowedTabsKey = options.allowedTabs.join("|");
  const [status, setStatus] = useState(options.defaultStatus);
  const [legacySnapshot, setLegacySnapshot] = useState<CapabilityWorkspaceSnapshot | null>(null);

  function normalizeTab(tab: string): string {
    return options.allowedTabs.includes(tab) ? tab : options.defaultTab;
  }

  useEffect(() => {
    if (!user) {
      setStatus(options.defaultStatus);
      setLegacySnapshot(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const snapshot = await loadCapabilityWorkspace(user.id, options.capabilityId);
      if (cancelled) {
        return;
      }

      if (snapshot) {
        setStatus(snapshot.status);
        setLegacySnapshot({
          ...snapshot,
          activeWorkspaceTab: normalizeTab(snapshot.activeWorkspaceTab),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allowedTabsKey,
    options.capabilityId,
    options.defaultBrief,
    options.defaultExecutionMode,
    options.defaultStatus,
    options.defaultTab,
    user,
  ]);
  const contract = useWorkspaceContract({
    workspace: {
      cwdPath: workspace.cwdPath,
      files: workspace.files,
      entries: workspace.entries,
      workspaceContext: workspace.workspaceContext,
      createDirectory: workspace.createDirectory,
      changeDirectory: workspace.changeDirectory,
      updateFilesystem: workspace.updateFilesystem,
      getState: workspace.getState,
    },
    capabilityId: options.capabilityId,
    capabilityTitle: options.capabilityTitle,
    defaultGoal: options.defaultBrief,
    defaultTab: options.defaultTab,
    defaultExecutionMode: options.defaultExecutionMode ?? "interactive",
    legacySnapshot,
  });

  const handleFiles = useCallback(async (nextFiles: FileList | null) => {
    if (!nextFiles?.length) {
      return;
    }

    setStatus("Profiling selected files locally before exposing safe metadata to the agent.");
    await workspace.handleSelectFiles(nextFiles);
    const builtCount = nextFiles.length;
    setStatus(
      `Added ${builtCount} workspace file${builtCount === 1 ? "" : "s"} to ${workspace.cwdPath}. ${
        builtCount === 1 ? "The file is" : "The files are"
      } ready for the agent.`,
    );
  }, [workspace.cwdPath, workspace.handleSelectFiles]);

  const appendFiles = useCallback((nextFiles: LocalWorkspaceFile[]) => {
    if (!nextFiles.length) {
      return [];
    }
    const storedFiles = workspace.appendFiles(nextFiles, "derived");
    setStatus(
      `Added ${nextFiles.length} derived file${nextFiles.length === 1 ? "" : "s"} to ${workspace.cwdPath}.`,
    );
    return storedFiles;
  }, [workspace.appendFiles, workspace.cwdPath]);

  const setFiles = useCallback((nextFiles: LocalWorkspaceFile[]) => {
    workspace.replaceFiles(nextFiles, "demo");
  }, [workspace.replaceFiles]);

  const handleRemoveEntry = useCallback((entryId: string) => {
    workspace.handleRemoveEntry(entryId);
    contract.setReportEffects([]);
    setStatus("Removed the selected workspace entry.");
  }, [contract.setReportEffects, workspace.handleRemoveEntry]);

  const syncToolCatalog = useCallback((toolNames: string[]) => {
    workspace.updateFilesystem((filesystem) =>
      syncWorkspaceToolCatalog(filesystem, options.capabilityId, toolNames),
    );
  }, [options.capabilityId, workspace.updateFilesystem]);

  return {
    cwdPath: workspace.cwdPath,
    entries: workspace.entries,
    files: workspace.files,
    workspaceContext: workspace.workspaceContext,
    workspaceHydrated: workspace.hydrated,
    breadcrumbs: workspace.breadcrumbs,
    getState: workspace.getState,
    setFiles,
    appendFiles,
    status,
    setStatus,
    investigationBrief: contract.investigationBrief,
    setInvestigationBrief: contract.setInvestigationBrief,
    activeWorkspaceTab: contract.activeWorkspaceTab,
    setActiveWorkspaceTab: contract.setActiveWorkspaceTab,
    executionMode: contract.executionMode,
    setExecutionMode: contract.setExecutionMode,
    reportEffects: contract.reportEffects,
    setReportEffects: contract.setReportEffects,
    appendReportEffects: contract.appendReportEffects,
    currentReportId: contract.currentReportId,
    reportIds: contract.reportIds,
    currentReport: contract.currentReport,
    workspaceBootstrapMetadata: contract.bootstrapMetadata,
    syncToolCatalog,
    handleFiles,
    handleRemoveEntry,
    createDirectory: workspace.createDirectory,
    changeDirectory: workspace.changeDirectory,
    updateFilesystem: workspace.updateFilesystem,
  };
}
