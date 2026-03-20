import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppState } from "../app/context";
import { useWorkspaceSurface } from "../app/workspace";
import { listAllWorkspaceFileNodes, removeWorkspaceEntry } from "../lib/workspace-fs";
import { loadToolProviderWorkspace, type ToolProviderWorkspaceSnapshot } from "../lib/workspace-store";
import type { ClientEffect } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import { useWorkspaceContract } from "./shared/useWorkspaceContract";
import {
  buildWorkspaceStateMetadata,
  pruneWorkspacePdfSmartSplitBundles,
  readWorkspacePdfSmartSplitBundles,
  syncWorkspaceToolCatalog,
} from "../lib/workspace-contract";
import type { ShellWorkspaceArtifact } from "./types";

export function useToolFileWorkspace(options: {
  toolProviderId?: string;
  toolProviderTitle?: string;
  capabilityId?: string;
  capabilityTitle?: string;
  defaultStatus: string;
  defaultBrief: string;
  defaultTab: string;
  allowedTabs: string[];
}) {
  const toolProviderId = options.toolProviderId ?? options.capabilityId;
  const toolProviderTitle =
    options.toolProviderTitle ?? options.capabilityTitle;
  if (!toolProviderId || !toolProviderTitle) {
    throw new Error("useToolFileWorkspace requires a toolProviderId and toolProviderTitle.");
  }
  const { user } = useAppState();
  const workspace = useWorkspaceSurface({
    surfaceKey: toolProviderId,
  });
  const allowedTabsKey = options.allowedTabs.join("|");
  const [status, setStatus] = useState(options.defaultStatus);
  const [legacySnapshot, setLegacySnapshot] = useState<ToolProviderWorkspaceSnapshot | null>(null);
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);
  const [pendingWorkspaceTab, setPendingWorkspaceTab] = useState<string | null>(null);
  const demoWorkspaceOwnedRef = useRef(false);
  const defaultNonDemoTab = useMemo(
    () => options.allowedTabs.find((tab) => tab !== "demo") ?? options.defaultTab,
    [allowedTabsKey, options.defaultTab, options.allowedTabs],
  );

  function normalizeTab(tab: string): string {
    return options.allowedTabs.includes(tab) ? tab : options.defaultTab;
  }

  useEffect(() => {
    if (!user) {
      setStatus(options.defaultStatus);
      setLegacySnapshot(null);
      setReportEffects([]);
      setPendingWorkspaceTab(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const snapshot = await loadToolProviderWorkspace(user.id, toolProviderId);
      if (cancelled) {
        return;
      }

      if (snapshot) {
        setStatus(snapshot.status);
        setLegacySnapshot({
          ...snapshot,
          activeWorkspaceTab: normalizeTab(snapshot.activeWorkspaceTab),
        });
        setReportEffects(snapshot.reportEffects);
      } else {
      setReportEffects([]);
    }
  })();

    return () => {
      cancelled = true;
    };
  }, [
    allowedTabsKey,
    toolProviderId,
    options.defaultBrief,
    options.defaultStatus,
    options.defaultTab,
    user,
  ]);
  const storedSurfaceTab = normalizeTab(
    workspace.activeSurfaceTab ??
      legacySnapshot?.activeWorkspaceTab ??
      options.defaultTab,
  );
  const contract = useWorkspaceContract({
    workspace: {
      toolProviderId,
      toolProviderTitle,
      workspaceId: workspace.selectedWorkspaceId,
      files: workspace.files,
      entries: workspace.entries,
      workspaceContext: workspace.workspaceContext,
      updateFilesystem: workspace.updateFilesystem,
      getState: workspace.getState,
    },
    toolProviderId,
    toolProviderTitle,
    defaultGoal: options.defaultBrief,
    defaultTab: options.defaultTab,
    allowedTabs: options.allowedTabs,
    legacySnapshot,
  });

  useEffect(() => {
    if (pendingWorkspaceTab && !workspace.hydrated) {
      return;
    }

    if (pendingWorkspaceTab === "demo") {
      if (workspace.selectedWorkspaceKind !== "demo") {
        return;
      }
      workspace.setActiveSurfaceTab("demo");
      setPendingWorkspaceTab(null);
      return;
    }

    if (pendingWorkspaceTab && workspace.selectedWorkspaceKind !== "demo") {
      workspace.setActiveSurfaceTab(pendingWorkspaceTab);
      demoWorkspaceOwnedRef.current = false;
      setPendingWorkspaceTab(null);
    }
  }, [
    pendingWorkspaceTab,
    workspace.hydrated,
    workspace.selectedWorkspaceKind,
    workspace.setActiveSurfaceTab,
  ]);

  useEffect(() => {
    if (pendingWorkspaceTab || workspace.selectedWorkspaceKind === "demo") {
      return;
    }
    if (storedSurfaceTab === "demo") {
      workspace.setActiveSurfaceTab(defaultNonDemoTab);
    }
  }, [
    defaultNonDemoTab,
    pendingWorkspaceTab,
    storedSurfaceTab,
    workspace.selectedWorkspaceKind,
    workspace.setActiveSurfaceTab,
  ]);

  const activeWorkspaceTab = useMemo(() => {
    if (pendingWorkspaceTab === "demo") {
      if (workspace.selectedWorkspaceKind === "demo") {
        return "demo";
      }
      return storedSurfaceTab === "demo" ? defaultNonDemoTab : storedSurfaceTab;
    }
    if (pendingWorkspaceTab && workspace.selectedWorkspaceKind !== "demo") {
      return pendingWorkspaceTab;
    }
    if (workspace.selectedWorkspaceKind !== "demo" && storedSurfaceTab === "demo") {
      return defaultNonDemoTab;
    }
    return storedSurfaceTab;
  }, [
    defaultNonDemoTab,
    pendingWorkspaceTab,
    storedSurfaceTab,
    workspace.selectedWorkspaceKind,
  ]);

  const setActiveWorkspaceTab = useCallback((nextTab: string) => {
    const normalizedNextTab = normalizeTab(nextTab);

    if (normalizedNextTab === "demo") {
      if (workspace.selectedWorkspaceKind === "demo") {
        workspace.setActiveSurfaceTab("demo");
        return;
      }
      demoWorkspaceOwnedRef.current = true;
      setPendingWorkspaceTab("demo");
      workspace.activateDemoWorkspace();
      return;
    }

    if (workspace.selectedWorkspaceKind === "demo" && demoWorkspaceOwnedRef.current) {
      setPendingWorkspaceTab(normalizedNextTab);
      workspace.restorePreviousWorkspace();
      return;
    }

    demoWorkspaceOwnedRef.current = false;
    workspace.setActiveSurfaceTab(normalizedNextTab);
  }, [
    workspace.activateDemoWorkspace,
    workspace.restorePreviousWorkspace,
    workspace.selectedWorkspaceKind,
    workspace.setActiveSurfaceTab,
  ]);

  const handleFiles = useCallback(async (nextFiles: FileList | null) => {
    if (!nextFiles?.length) {
      return;
    }

    setStatus("Profiling selected files locally before exposing safe metadata to the agent.");
    await workspace.handleSelectFiles(nextFiles);
    const builtCount = nextFiles.length;
    setStatus(
      `Added ${builtCount} file${builtCount === 1 ? "" : "s"} to ${workspace.selectedWorkspaceName}.`,
    );
  }, [workspace.handleSelectFiles, workspace.selectedWorkspaceName]);

  const appendFiles = useCallback((nextFiles: LocalWorkspaceFile[]) => {
    if (!nextFiles.length) {
      return [];
    }
    const storedFiles = workspace.appendFiles(nextFiles, "derived");
    setStatus(
      `Added ${nextFiles.length} derived file${nextFiles.length === 1 ? "" : "s"} to ${workspace.selectedWorkspaceName}.`,
    );
    return storedFiles;
  }, [workspace.appendFiles, workspace.selectedWorkspaceName]);

  const setFiles = useCallback((nextFiles: LocalWorkspaceFile[]) => {
    workspace.replaceFiles(nextFiles, "demo");
  }, [workspace.replaceFiles]);

  const handleRemoveEntry = useCallback((entryId: string) => {
    workspace.updateFilesystem((filesystem) =>
      pruneWorkspacePdfSmartSplitBundles(removeWorkspaceEntry(filesystem, entryId)),
    );
    setReportEffects([]);
    setStatus("Removed the selected workspace entry.");
  }, [setReportEffects, setStatus, workspace.updateFilesystem]);

  const syncToolCatalog = useCallback((toolNames: string[]) => {
    workspace.updateFilesystem((filesystem) =>
      syncWorkspaceToolCatalog(filesystem, toolProviderId, toolNames),
    );
  }, [toolProviderId, workspace.updateFilesystem]);

  const appendReportEffects = useCallback((effects: ClientEffect[]) => {
    if (!effects.length) {
      return;
    }
    setReportEffects((current) => [...current, ...effects]);
  }, []);

  const artifacts = useMemo<ShellWorkspaceArtifact[]>(
    () =>
      listAllWorkspaceFileNodes(workspace.filesystem)
        .map((node) => ({
          entryId: node.id,
          createdAt: node.created_at,
          bucket: node.bucket,
          source: node.source,
          producerKey: node.producer_key,
          producerLabel: node.producer_label,
          file: node.file,
        })),
    [workspace.filesystem],
  );
  const smartSplitBundles = useMemo(
    () => readWorkspacePdfSmartSplitBundles(workspace.filesystem),
    [workspace.filesystem],
  );

  const workspaceStateMetadata = buildWorkspaceStateMetadata(
    workspace.filesystem,
    workspace.selectedWorkspaceId,
  );

  return {
    filesystem: workspace.filesystem,
    entries: workspace.entries,
    files: workspace.files,
    workspaceContext: workspace.workspaceContext,
    workspaceHydrated: workspace.hydrated,
    getState: workspace.getState,
    workspaces: workspace.workspaces,
    selectedWorkspaceId: workspace.selectedWorkspaceId,
    selectedWorkspaceName: workspace.selectedWorkspaceName,
    selectedWorkspaceKind: workspace.selectedWorkspaceKind,
    selectWorkspace: workspace.selectWorkspace,
    createWorkspace: workspace.createWorkspace,
    clearWorkspace: workspace.clearWorkspace,
    setFiles,
    appendFiles,
    artifacts,
    smartSplitBundles,
    status,
    setStatus,
    investigationBrief: contract.investigationBrief,
    setInvestigationBrief: contract.setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    appendReportEffects,
    currentReportId: contract.currentReportId,
    reportIds: contract.reportIds,
    reports: contract.reports,
    reportSummaries: contract.reportSummaries,
    selectCurrentReport: contract.selectCurrentReport,
    currentReport: contract.currentReport,
    workspaceBootstrapMetadata: contract.bootstrapMetadata,
    workspaceStateMetadata,
    syncToolCatalog,
    handleFiles,
    handleRemoveEntry,
    updateFilesystem: workspace.updateFilesystem,
  };
}

export const useCapabilityFileWorkspace = useToolFileWorkspace;
