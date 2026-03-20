import { useEffect } from "react";
import styled from "styled-components";

import { ChatKitPane, type ChatKitQuickAction } from "./ChatKitPane";
import { MetaText, sectionPanelCss } from "../app/styles";
import type { CapabilityBundle, CapabilityClientTool, CapabilityDemoScenario } from "../capabilities/types";
import type { ClientEffect, ExecutionMode, WorkspaceState } from "../types/analysis";
import { devLogger } from "../lib/dev-logging";
import type { LocalWorkspaceFile } from "../types/report";
import {
  buildDemoValidatorCapabilityBundle,
  buildDemoValidatorPrompt,
} from "../capabilities/shared/demoValidator";

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
  onPrepareDemoRun,
  showScenarioNotes = true,
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
  onPrepareDemoRun?: () => Promise<unknown> | void;
  showScenarioNotes?: boolean;
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
          beforeRun: onPrepareDemoRun,
          followUp: {
            label: "Demo validation",
            prompt: buildDemoValidatorPrompt(scenario),
            model: scenario.model,
            capabilityBundle: buildDemoValidatorCapabilityBundle(),
          },
        },
      ]
    : undefined;

  return (
    <>
      {showScenarioNotes && hasDemoScenarioNotes(scenario) ? (
        <DemoNotesCard data-testid="capability-demo-notes">
          <DemoNotesTitle>Demo notes</DemoNotesTitle>
          {scenario?.expectedOutcomes?.length ? (
            <DemoNotesMeta>{scenario.expectedOutcomes.join(" ")}</DemoNotesMeta>
          ) : null}
          {scenario?.notes?.length ? (
            <DemoNotesMeta>{scenario.notes.join(" ")}</DemoNotesMeta>
          ) : null}
        </DemoNotesCard>
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
        showChatKitHeader={showChatKitHeader}
      />
    </>
  );
}

const DemoNotesCard = styled.section`
  ${sectionPanelCss("0.9rem", "0.42rem")};
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(250, 245, 238, 0.92)),
    var(--panel);
`;

const DemoNotesTitle = styled.strong`
  color: var(--ink);
  font-size: 0.88rem;
  line-height: 1.15;
`;

const DemoNotesMeta = styled(MetaText)`
  color: color-mix(in srgb, var(--ink) 72%, var(--muted));
  font-size: 0.82rem;
  line-height: 1.5;
`;
