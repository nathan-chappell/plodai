import { useEffect } from "react";

import { ChatKitPane, type ChatKitQuickAction } from "./ChatKitPane";
import { ChatKitPaneMeta } from "./styles";
import type { CapabilityBundle, CapabilityClientTool, CapabilityDemoScenario } from "../capabilities/types";
import type { ClientEffect, ExecutionMode, WorkspaceState } from "../types/analysis";
import { devLogger } from "../lib/dev-logging";
import type { LocalWorkspaceFile } from "../types/report";

export function hasDemoScenarioNotes(scenario: CapabilityDemoScenario | null): boolean {
  return Boolean(scenario?.expectedOutcomes?.length || scenario?.notes?.length);
}

export function CapabilityDemoPane({
  scenario,
  loading,
  error,
  capabilityBundle,
  files,
  workspaceState,
  executionMode,
  onExecutionModeChange,
  clientTools,
  onEffects,
  onFilesAdded,
  showScenarioNotes = true,
  showExecutionModeControls = true,
  feedbackButtonVariant = "button",
  showChatKitHeader = true,
}: {
  scenario: CapabilityDemoScenario | null;
  loading: boolean;
  error: string | null;
  capabilityBundle: CapabilityBundle;
  files: LocalWorkspaceFile[];
  workspaceState?: WorkspaceState;
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
  showScenarioNotes?: boolean;
  showExecutionModeControls?: boolean;
  feedbackButtonVariant?: "button" | "icon";
  showChatKitHeader?: boolean;
}) {
  const workspaceFileIds = new Set(files.map((file) => file.id));
  const demoReady = scenario ? scenario.workspaceSeed.every((file) => workspaceFileIds.has(file.id)) : false;
  const demoPreparing = loading || (!error && !demoReady);
  useEffect(() => {
    devLogger.demoState({
      capabilityId: capabilityBundle.root_capability_id,
      active: true,
      ready: true,
      loading,
      fileCount: files.length,
      seedCount: scenario?.workspaceSeed.length,
      demoReady,
      error,
      scenarioId: scenario?.id ?? null,
    });
  }, [capabilityBundle.root_capability_id, demoReady, error, files.length, loading, scenario]);
  const prompts = scenario
    ? [
        {
          label: "Run demo",
          prompt: scenario.initialPrompt,
          icon: "bolt" as const,
        },
      ]
    : undefined;
  const quickActions: ChatKitQuickAction[] | undefined = scenario
    ? [
        {
          label: "Run demo",
          prompt: scenario.initialPrompt,
          model: scenario.model,
        },
      ]
    : undefined;

  return (
    <>
      {showScenarioNotes && hasDemoScenarioNotes(scenario) ? (
        <section data-testid="capability-demo-notes">
          <strong>Demo notes</strong>
          {scenario?.expectedOutcomes?.length ? (
            <ChatKitPaneMeta>{scenario.expectedOutcomes.join(" ")}</ChatKitPaneMeta>
          ) : null}
          {scenario?.notes?.length ? (
            <ChatKitPaneMeta>{scenario.notes.join(" ")}</ChatKitPaneMeta>
          ) : null}
        </section>
      ) : null}

      <ChatKitPane
        capabilityBundle={capabilityBundle}
        enabled={demoReady}
        files={files}
        workspaceState={workspaceState}
        investigationBrief={scenario?.summary ?? ""}
        clientTools={clientTools}
        executionMode={executionMode}
        onExecutionModeChange={onExecutionModeChange}
        onEffects={onEffects}
        onFilesAdded={onFilesAdded}
        headerTitle={scenario?.title}
        greeting="Run the curated demo."
        prompts={prompts}
        composerPlaceholder="Run the scripted demo or continue from the latest results"
        quickActions={quickActions}
        colorScheme="light"
        showDictation={false}
        showPaneHeader={false}
        showDefaultModelMeta={false}
        surfaceMinHeight={620}
        emptyMessage={demoPreparing ? "Preparing the demo workspace..." : error ?? "Demo unavailable."}
        showExecutionModeControls={showExecutionModeControls}
        feedbackButtonVariant={feedbackButtonVariant}
        showChatKitHeader={showChatKitHeader}
      />
    </>
  );
}
