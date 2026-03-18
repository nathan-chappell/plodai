import { useEffect, useEffectEvent, useState } from "react";

import type { CapabilityDemoScenario } from "../types";
import type { ClientEffect, ExecutionMode } from "../../types/analysis";
import { devLogger } from "../../lib/dev-logging";
import type { LocalWorkspaceFile } from "../../types/report";

const demoScenarioCache = new WeakMap<
  () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>,
  CapabilityDemoScenario | Promise<CapabilityDemoScenario>
>();

async function resolveDemoScenario(
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>,
): Promise<CapabilityDemoScenario> {
  const cached = demoScenarioCache.get(buildDemoScenario);
  if (cached) {
    return await cached;
  }

  const pendingScenario = Promise.resolve(buildDemoScenario());
  demoScenarioCache.set(buildDemoScenario, pendingScenario);
  try {
    const scenario = await pendingScenario;
    demoScenarioCache.set(buildDemoScenario, scenario);
    return scenario;
  } catch (error) {
    demoScenarioCache.delete(buildDemoScenario);
    throw error;
  }
}

export function useDemoScenario(options: {
  active: boolean;
  capabilityId: string;
  ready?: boolean;
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>;
  setFiles: (files: LocalWorkspaceFile[]) => void;
  setStatus: (value: string) => void;
  setReportEffects: (value: ClientEffect[]) => void;
  setExecutionMode: (value: ExecutionMode) => void;
}) {
  const { active, capabilityId, ready = true, buildDemoScenario, setExecutionMode, setFiles, setReportEffects, setStatus } = options;
  const [scenario, setScenario] = useState<CapabilityDemoScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyScenario = useEffectEvent((nextScenario: CapabilityDemoScenario) => {
    devLogger.demoState({
      capabilityId,
      active,
      ready,
      loading: true,
      fileCount: nextScenario.workspaceSeed.length,
      seedCount: nextScenario.workspaceSeed.length,
      scenarioId: nextScenario.id,
    });
    setScenario(nextScenario);
    setFiles(nextScenario.workspaceSeed);
    setReportEffects([]);
    setExecutionMode(nextScenario.defaultExecutionMode ?? "batch");
    setStatus(`Loaded demo workspace for ${nextScenario.title}. Click Run demo to watch it work.`);
  });

  const applyScenarioError = useEffectEvent((message: string) => {
    setError(message);
    setStatus(message);
    devLogger.demoState({
      capabilityId,
      active,
      ready,
      loading: false,
      error: message,
      scenarioId: scenario?.id ?? null,
    });
  });

  useEffect(() => {
    devLogger.demoState({
      capabilityId,
      active,
      ready,
      loading,
      error,
      scenarioId: scenario?.id ?? null,
      seedCount: scenario?.workspaceSeed.length,
    });
  }, [active, capabilityId, error, loading, ready, scenario]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }

    if (!ready) {
      setLoading(true);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextScenario = await resolveDemoScenario(buildDemoScenario);
        if (cancelled) {
          return;
        }
        applyScenario(nextScenario);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to prepare the demo scenario.";
        applyScenarioError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, buildDemoScenario, ready]);

  return {
    scenario,
    loading,
    error,
  };
}
