import { useEffect, useState } from "react";

import { useAppState } from "../app/context";
import {
  clearCapabilityWorkspace,
  loadCapabilityWorkspace,
  saveCapabilityWorkspace,
  type CapabilityWorkspaceSnapshot,
} from "../lib/workspace-store";
import { buildWorkspaceFile } from "../lib/workspace-files";
import type { ClientEffect } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

export function useCapabilityFileWorkspace(options: {
  capabilityId: string;
  defaultStatus: string;
  defaultBrief: string;
  defaultTab: string;
}) {
  const { user } = useAppState();
  const [files, setFiles] = useState<LocalWorkspaceFile[]>([]);
  const [status, setStatus] = useState(options.defaultStatus);
  const [investigationBrief, setInvestigationBrief] = useState(options.defaultBrief);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState(options.defaultTab);
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!user) {
      setFiles([]);
      setStatus(options.defaultStatus);
      setInvestigationBrief(options.defaultBrief);
      setActiveWorkspaceTab(options.defaultTab);
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
        setFiles(snapshot.files);
        setStatus(snapshot.status);
        setInvestigationBrief(snapshot.investigationBrief);
        setActiveWorkspaceTab(snapshot.activeWorkspaceTab);
        setReportEffects(snapshot.reportEffects);
      } else {
        setFiles([]);
        setStatus(options.defaultStatus);
        setInvestigationBrief(options.defaultBrief);
        setActiveWorkspaceTab(options.defaultTab);
        setReportEffects([]);
      }
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [options.capabilityId, options.defaultBrief, options.defaultStatus, options.defaultTab, user]);

  useEffect(() => {
    if (!user || !hydrated) {
      return;
    }

    const snapshot: CapabilityWorkspaceSnapshot = {
      files,
      status,
      investigationBrief,
      activeWorkspaceTab,
      reportEffects,
    };

    const timeoutId = window.setTimeout(() => {
      void saveCapabilityWorkspace(user.id, options.capabilityId, snapshot);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeWorkspaceTab,
    files,
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
    const builtFiles = await Promise.all(Array.from(nextFiles).map((file) => buildWorkspaceFile(file)));
    setFiles(builtFiles);
    setReportEffects([]);
    setStatus(`Prepared ${builtFiles.length} workspace file${builtFiles.length === 1 ? "" : "s"} for the agent.`);
  }

  function appendFiles(nextFiles: LocalWorkspaceFile[]) {
    if (!nextFiles.length) {
      return;
    }
    setFiles((current) => [...current, ...nextFiles]);
    setStatus(`Added ${nextFiles.length} derived file${nextFiles.length === 1 ? "" : "s"} to the workspace.`);
  }

  function handleClearFiles() {
    setFiles([]);
    setReportEffects([]);
    setStatus("Cleared the workspace file inventory.");
    if (user) {
      void clearCapabilityWorkspace(user.id, options.capabilityId);
    }
  }

  return {
    files,
    setFiles,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearFiles,
  };
}
