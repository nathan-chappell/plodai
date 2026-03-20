import { useEffect, useEffectEvent, useState } from "react";

import type { CapabilityDemoScenario } from "../types";
import type { ClientEffect } from "../../types/analysis";
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
  files: LocalWorkspaceFile[];
  setFiles: (files: LocalWorkspaceFile[]) => void;
  setStatus: (value: string) => void;
  setReportEffects: (value: ClientEffect[]) => void;
}) {
  const {
    active,
    capabilityId,
    ready = true,
    buildDemoScenario,
    files,
    setFiles,
    setReportEffects,
    setStatus,
  } = options;
  const [scenario, setScenario] = useState<CapabilityDemoScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasScenarioSeed = useEffectEvent((nextScenario: CapabilityDemoScenario) => {
    const workspaceFileIds = new Set(files.map((file) => file.id));
    return nextScenario.workspaceSeed.every((file) => workspaceFileIds.has(file.id));
  });

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

  const prepareDemoRun = useEffectEvent(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextScenario = await resolveDemoScenario(buildDemoScenario);
      setScenario(nextScenario);
      applyScenario(nextScenario);
      return nextScenario;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare the demo scenario.";
      applyScenarioError(message);
      return null;
    } finally {
      setLoading(false);
    }
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
        setScenario(nextScenario);
        if (!hasScenarioSeed(nextScenario)) {
          applyScenario(nextScenario);
        }
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
    prepareDemoRun,
  };
}
