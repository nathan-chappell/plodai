import { useCallback, useEffect, useState } from "react";

import type { CapabilityDemoScenario } from "../types";
import type { ClientEffect } from "../../types/analysis";
import type { LocalWorkspaceFile } from "../../types/report";

export function useDemoScenario(options: {
  active: boolean;
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>;
  setFiles: (files: LocalWorkspaceFile[]) => void;
  setStatus: (value: string) => void;
  setReportEffects: (value: ClientEffect[]) => void;
}) {
  const { active, buildDemoScenario, setFiles, setReportEffects, setStatus } = options;
  const [scenario, setScenario] = useState<CapabilityDemoScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadScenario = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextScenario = await buildDemoScenario();
      setScenario(nextScenario);
      setFiles(nextScenario.workspaceSeed);
      setReportEffects([]);
      setStatus(`Loaded demo workspace for ${nextScenario.title}. Click Run demo to watch it work.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare the demo scenario.";
      setError(message);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, [buildDemoScenario, setFiles, setReportEffects, setStatus]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadScenario();
  }, [active, loadScenario]);

  return {
    scenario,
    loading,
    error,
    reloadScenario: loadScenario,
  };
}
