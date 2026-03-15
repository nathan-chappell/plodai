import { useEffect, useState } from "react";

import { useAppState } from "../app/context";
import { parseCsvPreview } from "../lib/csv";
import {
  clearReportFoundryWorkspace,
  loadReportFoundryWorkspace,
  saveReportFoundryWorkspace,
  type ReportFoundryWorkspaceSnapshot,
} from "../lib/workspace-store";
import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";

type WorkspaceTab = "report" | "datasets" | "goal" | "smoke";
const DEFAULT_STATUS = "Add CSV files to begin a local-first investigation.";
const DEFAULT_BRIEF =
  "Summarize the attached files, identify the strongest trends and anomalies, and explain what deserves follow-up.";

export function useReportFoundryWorkspace() {
  const { user } = useAppState();
  const [datasets, setDatasets] = useState<LocalDataset[]>([]);
  const [status, setStatus] = useState<string>(DEFAULT_STATUS);
  const [investigationBrief, setInvestigationBrief] = useState(DEFAULT_BRIEF);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("report");
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!user) {
      setDatasets([]);
      setStatus(DEFAULT_STATUS);
      setInvestigationBrief(DEFAULT_BRIEF);
      setActiveWorkspaceTab("report");
      setReportEffects([]);
      setHydrated(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      const snapshot = await loadReportFoundryWorkspace(user.id);
      if (cancelled) {
        return;
      }

      if (snapshot) {
        setDatasets(snapshot.datasets);
        setStatus(snapshot.status);
        setInvestigationBrief(snapshot.investigationBrief);
        setActiveWorkspaceTab(snapshot.activeWorkspaceTab);
        setReportEffects(snapshot.reportEffects);
      } else {
        setDatasets([]);
        setStatus(DEFAULT_STATUS);
        setInvestigationBrief(DEFAULT_BRIEF);
        setActiveWorkspaceTab("report");
        setReportEffects([]);
      }
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !hydrated) {
      return;
    }

    const snapshot: ReportFoundryWorkspaceSnapshot = {
      datasets,
      status,
      investigationBrief,
      activeWorkspaceTab,
      reportEffects,
    };

    const timeoutId = window.setTimeout(() => {
      void saveReportFoundryWorkspace(user.id, snapshot);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [activeWorkspaceTab, datasets, hydrated, investigationBrief, reportEffects, status, user]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setStatus("Profiling selected CSV files locally before exposing safe metadata to the agent.");
    const nextDatasets = await Promise.all(
      Array.from(files).map(async (file) => {
        const preview = await parseCsvPreview(file);
        return {
          id: crypto.randomUUID(),
          name: file.name,
          row_count: preview.rowCount,
          columns: preview.columns,
          numeric_columns: preview.numericColumns,
          sample_rows: preview.sampleRows,
          rows: preview.rows,
          preview_rows: preview.previewRows,
        } satisfies LocalDataset;
      }),
    );

    setDatasets(nextDatasets);
    setReportEffects([]);
    setStatus(`Prepared ${nextDatasets.length} dataset summary${nextDatasets.length === 1 ? "" : "ies"} for analysis.`);
  }

  function handleClearDatasets() {
    setDatasets([]);
    setReportEffects([]);
    setStatus("Cleared dataset inventory. Add CSV files to begin another investigation.");
    if (user) {
      void clearReportFoundryWorkspace(user.id);
    }
  }

  function handleLoadSmokeDatasets(nextDatasets: LocalDataset[]) {
    setDatasets(nextDatasets);
    setReportEffects([]);
    setStatus(`Loaded ${nextDatasets.length} smoke dataset${nextDatasets.length === 1 ? "" : "s"} into the workspace.`);
    setActiveWorkspaceTab("report");
  }

  return {
    datasets,
    status,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearDatasets,
    handleLoadSmokeDatasets,
  };
}

export type ReportFoundryWorkspaceTab = WorkspaceTab;
