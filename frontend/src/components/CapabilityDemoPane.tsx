import { useEffect } from "react";
import styled from "styled-components";

import { ChatKitPane, type ChatKitQuickAction } from "./ChatKitPane";
import { MetaText, sectionPanelCss } from "../app/styles";
import type {
  ToolProviderBundle,
  ToolProviderClientTool,
  ToolProviderDemoScenario,
} from "../tools/types";
import type { ClientEffect, WorkspaceState } from "../types/analysis";
import { devLogger } from "../lib/dev-logging";
import type { LocalWorkspaceFile } from "../types/report";

export function hasDemoScenarioNotes(scenario: ToolProviderDemoScenario | null): boolean {
  return Boolean(scenario?.expectedOutcomes?.length || scenario?.notes?.length);
}

function buildDemoNotesBullets(
  scenario: ToolProviderDemoScenario | null,
): string[] {
  if (!scenario) {
    return [];
  }

  return [...(scenario.expectedOutcomes ?? []), ...(scenario.notes ?? [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function CapabilityDemoPane({
  scenario,
  loading,
  error,
  toolProviderBundle,
  capabilityBundle,
  files,
  workspaceState,
  clientTools,
  onEffects,
  onFilesAdded,
  onPrepareDemoRun,
  showScenarioNotes = true,
  showChatKitHeader = true,
}: {
  scenario: ToolProviderDemoScenario | null;
  loading: boolean;
  error: string | null;
  toolProviderBundle?: ToolProviderBundle;
  capabilityBundle?: ToolProviderBundle;
  files: LocalWorkspaceFile[];
  workspaceState?: WorkspaceState;
  clientTools: ToolProviderClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
  onPrepareDemoRun?: () => Promise<unknown> | void;
  showScenarioNotes?: boolean;
  showChatKitHeader?: boolean;
}) {
  const resolvedToolProviderBundle = toolProviderBundle ?? capabilityBundle;
  if (!resolvedToolProviderBundle) {
    throw new Error("CapabilityDemoPane requires a tool provider bundle.");
  }
  const workspaceFileIds = new Set(files.map((file) => file.id));
  const demoReady = scenario ? scenario.workspaceSeed.every((file) => workspaceFileIds.has(file.id)) : false;
  const demoPreparing = loading || (!error && !demoReady);
  const demoNotesBullets = buildDemoNotesBullets(scenario);
  useEffect(() => {
    devLogger.demoState({
      capabilityId: resolvedToolProviderBundle.root_tool_provider_id,
      active: true,
      ready: true,
      loading,
      fileCount: files.length,
      seedCount: scenario?.workspaceSeed.length,
      demoReady,
      error,
      scenarioId: scenario?.id ?? null,
    });
  }, [resolvedToolProviderBundle.root_tool_provider_id, demoReady, error, files.length, loading, scenario]);
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
        },
      ]
    : undefined;

  return (
    <>
      {showScenarioNotes && hasDemoScenarioNotes(scenario) ? (
        <DemoNotesCard data-testid="capability-demo-notes">
          <DemoNotesTitle>Demo notes</DemoNotesTitle>
          {demoNotesBullets.length ? (
            <DemoNotesList>
              {demoNotesBullets.map((bullet) => (
                <DemoNotesItem key={bullet}>{bullet}</DemoNotesItem>
              ))}
            </DemoNotesList>
          ) : null}
        </DemoNotesCard>
      ) : null}

      <ChatKitPane
        capabilityBundle={resolvedToolProviderBundle}
        enabled={demoReady}
        files={files}
        workspaceState={workspaceState}
        investigationBrief={scenario?.summary ?? ""}
        clientTools={clientTools}
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

const DemoNotesList = styled.ul`
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.28rem;
`;

const DemoNotesItem = styled(DemoNotesMeta).attrs({ as: "li" })`
  margin: 0;
`;
