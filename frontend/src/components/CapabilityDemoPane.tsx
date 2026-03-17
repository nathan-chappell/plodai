import { ChatKitHarness } from "./ChatKitPane";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneMeta,
  ChatKitPanePill,
  ChatKitPaneSurface,
  ChatKitPaneToolbar,
  ChatKitPaneToolbarButton,
} from "./styles";
import type { CapabilityBundle, CapabilityClientTool, CapabilityDemoScenario } from "../capabilities/types";
import type { ClientEffect } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

export function CapabilityDemoPane({
  scenario,
  loading,
  error,
  capabilityBundle,
  files,
  clientTools,
  onEffects,
  onFilesAdded,
  onReloadScenario,
}: {
  scenario: CapabilityDemoScenario | null;
  loading: boolean;
  error: string | null;
  capabilityBundle: CapabilityBundle;
  files: LocalWorkspaceFile[];
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
  onReloadScenario: () => void | Promise<void>;
}) {
  return (
    <ChatKitPaneCard>
      <ChatKitPanePill>Capability demo</ChatKitPanePill>
      <h2>{scenario?.title ?? (loading ? "Preparing demo..." : "Demo unavailable")}</h2>
      <ChatKitPaneMeta>
        {scenario?.summary ??
          (error
            ? error
            : "Preparing the mock workspace and scripted prompt for this capability demo.")}
      </ChatKitPaneMeta>

      {scenario?.expectedOutcomes?.length ? (
        <ul>
          {scenario.expectedOutcomes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      {scenario?.notes?.length ? (
        <ChatKitPaneMeta>{scenario.notes.join(" ")}</ChatKitPaneMeta>
      ) : null}

      <ChatKitPaneToolbar>
        <ChatKitPaneToolbarButton type="button" onClick={() => void onReloadScenario()} disabled={loading}>
          Reload demo files
        </ChatKitPaneToolbarButton>
      </ChatKitPaneToolbar>

      {scenario && files.length ? (
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          investigationBrief={scenario.summary}
          clientTools={clientTools}
          onEffects={onEffects}
          onFilesAdded={onFilesAdded}
          headerTitle={scenario.title}
          greeting={scenario.summary}
          composerPlaceholder="Run the scripted demo or ask a follow-up question"
          prompts={[
            {
              label: "Run demo",
              prompt: scenario.initialPrompt,
              icon: "bolt",
            },
          ]}
          quickActions={[
            {
              label: "Run demo",
              prompt: scenario.initialPrompt,
              model: scenario.model,
            },
          ]}
          colorScheme="light"
          showDictation={false}
        />
      ) : (
        <ChatKitPaneSurface $light>
          <ChatKitPaneEmpty>
            {loading ? "Preparing the demo workspace..." : error ?? "Load the demo scenario to begin."}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}
