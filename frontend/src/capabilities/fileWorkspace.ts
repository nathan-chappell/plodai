import { useEffect, useState } from "react";

import { useAppState } from "../app/context";
import { useWorkspaceSurface } from "../app/workspace";
import {
  loadCapabilityWorkspace,
  saveCapabilityWorkspace,
} from "../lib/workspace-store";
import type { ClientEffect, ExecutionMode } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

export function useCapabilityFileWorkspace(options: {
  capabilityId: string;
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
  const [investigationBrief, setInvestigationBrief] = useState(options.defaultBrief);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState(options.defaultTab);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    options.defaultExecutionMode ?? "interactive",
  );
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);
  const [hydrated, setHydrated] = useState(false);

  function normalizeTab(tab: string): string {
    return options.allowedTabs.includes(tab) ? tab : options.defaultTab;
  }

  useEffect(() => {
    if (!user) {
      setStatus(options.defaultStatus);
      setInvestigationBrief(options.defaultBrief);
      setActiveWorkspaceTab(options.defaultTab);
      setExecutionMode(options.defaultExecutionMode ?? "interactive");
      setReportEffects([]);
      setHydrated(false);
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
        setInvestigationBrief(snapshot.investigationBrief);
        setActiveWorkspaceTab(normalizeTab(snapshot.activeWorkspaceTab));
        setExecutionMode(snapshot.executionMode ?? options.defaultExecutionMode ?? "interactive");
        setReportEffects(snapshot.reportEffects);
      } else {
        setStatus(options.defaultStatus);
        setInvestigationBrief(options.defaultBrief);
        setActiveWorkspaceTab(options.defaultTab);
        setExecutionMode(options.defaultExecutionMode ?? "interactive");
        setReportEffects([]);
      }
      setHydrated(true);
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

  useEffect(() => {
    if (!user || !hydrated) {
      return;
    }

    const snapshot = {
      status,
      investigationBrief,
      activeWorkspaceTab,
      executionMode,
      reportEffects,
    } as const;

    const timeoutId = window.setTimeout(() => {
      void saveCapabilityWorkspace(user.id, options.capabilityId, snapshot);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeWorkspaceTab,
    executionMode,
    hydrated,
    investigationBrief,
    options.capabilityId,
    reportEffects,
    status,
    user,
  ]);

  async function handleFiles(nextFiles: FileList | null) {
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
  }

  function appendFiles(nextFiles: LocalWorkspaceFile[]) {
    if (!nextFiles.length) {
      return [];
    }
    const storedFiles = workspace.appendFiles(nextFiles, "derived");
    setStatus(
      `Added ${nextFiles.length} derived file${nextFiles.length === 1 ? "" : "s"} to ${workspace.cwdPath}.`,
    );
    return storedFiles;
  }

  function setFiles(nextFiles: LocalWorkspaceFile[]) {
    workspace.replaceFiles(nextFiles, "demo");
  }

  function handleRemoveEntry(entryId: string) {
    workspace.handleRemoveEntry(entryId);
    setReportEffects([]);
    setStatus("Removed the selected workspace entry.");
  }

  return {
    cwdPath: workspace.cwdPath,
    entries: workspace.entries,
    files: workspace.files,
    workspaceContext: workspace.workspaceContext,
    breadcrumbs: workspace.breadcrumbs,
    getState: workspace.getState,
    setFiles,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    executionMode,
    setExecutionMode,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
    createDirectory: workspace.createDirectory,
    changeDirectory: workspace.changeDirectory,
  };
}
