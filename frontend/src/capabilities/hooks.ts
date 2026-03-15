import { useEffect, useState } from "react";

import { parseCsvPreview } from "../lib/csv";
import { readStoredString, writeStoredString } from "../lib/storage";
import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";

const BRIEF_STORAGE_KEY = "ai-portfolio-report-foundry-brief";

type WorkspaceTab = "report" | "datasets" | "goal" | "smoke";

export function useReportFoundryWorkspace() {
  const [datasets, setDatasets] = useState<LocalDataset[]>([]);
  const [status, setStatus] = useState<string>("Add CSV files to begin a local-first investigation.");
  const [investigationBrief, setInvestigationBrief] = useState(
    "Summarize the attached files, identify the strongest trends and anomalies, and explain what deserves follow-up.",
  );
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("report");
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([]);

  useEffect(() => {
    const savedBrief = readStoredString(BRIEF_STORAGE_KEY);
    if (savedBrief) {
      setInvestigationBrief(savedBrief);
    }
  }, []);

  useEffect(() => {
    writeStoredString(BRIEF_STORAGE_KEY, investigationBrief);
  }, [investigationBrief]);

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
