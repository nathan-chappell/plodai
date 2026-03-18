import { ChatKitPane, type ChatKitQuickAction } from "./ChatKitPane";
import { ChatKitPaneMeta } from "./styles";
import type { CapabilityBundle, CapabilityClientTool, CapabilityDemoScenario } from "../capabilities/types";
import type { AppThreadMetadata, ClientEffect, ExecutionMode } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

export function CapabilityDemoPane({
  scenario,
  loading,
  error,
  capabilityBundle,
  files,
  workspaceBootstrap,
  executionMode,
  onExecutionModeChange,
  clientTools,
  onEffects,
  onFilesAdded,
}: {
  scenario: CapabilityDemoScenario | null;
  loading: boolean;
  error: string | null;
  capabilityBundle: CapabilityBundle;
  files: LocalWorkspaceFile[];
  workspaceBootstrap?: AppThreadMetadata["workspace_bootstrap"];
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
}) {
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
      {scenario?.expectedOutcomes?.length || scenario?.notes?.length ? (
        <details>
          <summary>Demo notes</summary>
          {scenario?.expectedOutcomes?.length ? (
            <ChatKitPaneMeta>{scenario.expectedOutcomes.join(" ")}</ChatKitPaneMeta>
          ) : null}
          {scenario?.notes?.length ? (
            <ChatKitPaneMeta>{scenario.notes.join(" ")}</ChatKitPaneMeta>
          ) : null}
        </details>
      ) : null}

      <ChatKitPane
        capabilityBundle={capabilityBundle}
        enabled={Boolean(scenario && files.length)}
        files={files}
        workspaceBootstrap={workspaceBootstrap}
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
        emptyMessage={loading ? "Preparing the demo workspace..." : error ?? "Load the demo scenario to begin."}
      />
    </>
  );
}
