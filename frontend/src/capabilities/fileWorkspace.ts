import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppState } from "../app/context";
import { useWorkspaceSurface } from "../app/workspace";
import { listAllWorkspaceFileNodes } from "../lib/workspace-fs";
import { loadCapabilityWorkspace, type CapabilityWorkspaceSnapshot } from "../lib/workspace-store";
import type { ClientEffect, ExecutionMode } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import { useWorkspaceContract } from "./shared/useWorkspaceContract";
import {
  buildWorkspaceStateMetadata,
  isVisibleWorkspaceStatePath,
  syncWorkspaceToolCatalog,
} from "../lib/workspace-contract";
import type { ShellWorkspaceArtifact } from "./types";
import { capabilityDefinitions } from "./definitions";

const producerLabelById = new Map(
  capabilityDefinitions.map((capability) => [capability.id, capability.navLabel]),
);

function resolveArtifactProducer(path: string, source: ShellWorkspaceArtifact["source"]): {
  producerKey: string;
  producerLabel: string;
} {
  const segments = path.split("/").filter(Boolean);
  const firstSegment = segments[0];
  if (source === "uploaded" || firstSegment === "uploaded") {
    return {
      producerKey: "uploaded",
      producerLabel: "Uploaded",
    };
  }
  if (firstSegment && producerLabelById.has(firstSegment)) {
    return {
      producerKey: firstSegment,
      producerLabel: producerLabelById.get(firstSegment) ?? firstSegment,
    };
  }
  return {
    producerKey: firstSegment ?? "workspace",
    producerLabel: firstSegment ? firstSegment.replace(/-/g, " ") : "Workspace",
  };
}

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
    defaultCwdPath: `/${options.capabilityId}/`,
  });
  const allowedTabsKey = options.allowedTabs.join("|");
  const [status, setStatus] = useState(options.defaultStatus);
  const [legacySnapshot, setLegacySnapshot] = useState<CapabilityWorkspaceSnapshot | null>(null);
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);
  const demoWorkspaceOwnedRef = useRef(false);

  function normalizeTab(tab: string): string {
    return options.allowedTabs.includes(tab) ? tab : options.defaultTab;
  }

  useEffect(() => {
    if (!user) {
      setStatus(options.defaultStatus);
      setLegacySnapshot(null);
      setReportEffects([]);
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
    options.capabilityId,
    options.defaultBrief,
    options.defaultExecutionMode,
    options.defaultStatus,
    options.defaultTab,
    user,
  ]);
  const contract = useWorkspaceContract({
    workspace: {
      activePrefix: workspace.activePrefix,
      cwdPath: workspace.cwdPath,
      files: workspace.files,
      entries: workspace.entries,
      workspaceContext: workspace.workspaceContext,
      setActivePrefix: workspace.setActivePrefix,
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

  useEffect(() => {
    if (contract.activeWorkspaceTab === "demo") {
      if (workspace.selectedWorkspaceKind !== "demo") {
        workspace.activateDemoWorkspace();
        demoWorkspaceOwnedRef.current = true;
      }
      return;
    }

    if (demoWorkspaceOwnedRef.current && workspace.selectedWorkspaceKind === "demo") {
      workspace.restorePreviousWorkspace();
    }
    demoWorkspaceOwnedRef.current = false;
  }, [
    contract.activeWorkspaceTab,
    workspace.activateDemoWorkspace,
    workspace.restorePreviousWorkspace,
    workspace.selectedWorkspaceKind,
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
    workspace.handleRemoveEntry(entryId);
    setReportEffects([]);
    setStatus("Removed the selected workspace entry.");
  }, [workspace.handleRemoveEntry]);

  const syncToolCatalog = useCallback((toolNames: string[]) => {
    workspace.updateFilesystem((filesystem) =>
      syncWorkspaceToolCatalog(filesystem, options.capabilityId, toolNames),
    );
  }, [options.capabilityId, workspace.updateFilesystem]);

  const appendReportEffects = useCallback((effects: ClientEffect[]) => {
    if (!effects.length) {
      return;
    }
    setReportEffects((current) => [...current, ...effects]);
  }, []);

  const artifacts = useMemo<ShellWorkspaceArtifact[]>(
    () =>
      listAllWorkspaceFileNodes(workspace.filesystem)
        .filter((node) => isVisibleWorkspaceStatePath(node.path))
        .map((node) => {
          const producer = resolveArtifactProducer(node.path, node.source);
          return {
            entryId: node.id,
            path: node.path,
            createdAt: node.created_at,
            source: node.source,
            producerKey: producer.producerKey,
            producerLabel: producer.producerLabel,
            file: node.file,
          };
        }),
    [workspace.filesystem],
  );

  const workspaceStateMetadata = buildWorkspaceStateMetadata(
    workspace.filesystem,
    workspace.activePrefix,
  );

  return {
    activePrefix: workspace.activePrefix,
    cwdPath: workspace.cwdPath,
    filesystem: workspace.filesystem,
    entries: workspace.entries,
    files: workspace.files,
    workspaceContext: workspace.workspaceContext,
    workspaceHydrated: workspace.hydrated,
    breadcrumbs: workspace.breadcrumbs,
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
    status,
    setStatus,
    investigationBrief: contract.investigationBrief,
    setInvestigationBrief: contract.setInvestigationBrief,
    activeWorkspaceTab: contract.activeWorkspaceTab,
    setActiveWorkspaceTab: contract.setActiveWorkspaceTab,
    executionMode: contract.executionMode,
    setExecutionMode: contract.setExecutionMode,
    reportEffects,
    setReportEffects,
    appendReportEffects,
    currentReportId: contract.currentReportId,
    reportIds: contract.reportIds,
    currentReport: contract.currentReport,
    workspaceBootstrapMetadata: contract.bootstrapMetadata,
    workspaceStateMetadata,
    syncToolCatalog,
    handleFiles,
    handleRemoveEntry,
    createDirectory: workspace.createDirectory,
    changeDirectory: workspace.changeDirectory,
    setActivePrefix: workspace.setActivePrefix,
    updateFilesystem: workspace.updateFilesystem,
  };
}
