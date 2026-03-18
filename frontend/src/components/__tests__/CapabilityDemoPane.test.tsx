// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityBundle, CapabilityDemoScenario } from "../../capabilities/types";
import type { LocalWorkspaceFile } from "../../types/report";

function MockChatKitPane({
  enabled,
  emptyMessage,
  showExecutionModeControls,
  feedbackButtonVariant,
  showChatKitHeader,
}: {
  enabled: boolean;
  emptyMessage?: string;
  showExecutionModeControls?: boolean;
  feedbackButtonVariant?: string;
  showChatKitHeader?: boolean;
}) {
  return enabled ? (
    <div
      data-feedback-variant={feedbackButtonVariant}
      data-show-chatkit-header={String(showChatKitHeader)}
      data-show-execution-mode-controls={String(showExecutionModeControls)}
      data-testid="mock-chatkit-mounted"
    >
      mock chatkit mounted
    </div>
  ) : (
    <div data-testid="mock-chatkit-empty">{emptyMessage}</div>
  );
}

vi.mock("../ChatKitPane", () => ({
  ChatKitPane: MockChatKitPane,
}));

import { CapabilityDemoPane } from "../CapabilityDemoPane";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const capabilityBundle: CapabilityBundle = {
  root_capability_id: "csv-agent",
  capabilities: [
    {
      capability_id: "csv-agent",
      agent_name: "CSV Agent",
      instructions: "Inspect CSV files.",
      client_tools: [],
      handoff_targets: [],
    },
  ],
};

const demoSeedFile: LocalWorkspaceFile = {
  id: "demo-seed",
  name: "demo.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 14,
  row_count: 1,
  columns: ["month"],
  numeric_columns: [],
  sample_rows: [{ month: "Jan" }],
  preview_rows: [{ month: "Jan" }],
  rows: [{ month: "Jan" }],
};

const scenario: CapabilityDemoScenario = {
  id: "csv-demo",
  title: "CSV demo",
  summary: "Run a lightweight CSV walkthrough.",
  initialPrompt: "Run the demo.",
  workspaceSeed: [demoSeedFile],
  defaultExecutionMode: "batch",
};

describe("CapabilityDemoPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows a preparing state before the demo scenario resolves", async () => {
    await act(async () => {
      root.render(
        <CapabilityDemoPane
          scenario={null}
          loading={false}
          error={null}
          capabilityBundle={capabilityBundle}
          files={[]}
          executionMode="batch"
          onExecutionModeChange={() => {}}
          clientTools={[]}
          onEffects={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Preparing the demo workspace...");
    expect(container.textContent).not.toContain("Load the demo scenario to begin.");
    expect(container.querySelector("[data-testid='mock-chatkit-mounted']")).toBeNull();
  });

  it("waits for demo seed files before mounting ChatKit", async () => {
    await act(async () => {
      root.render(
        <CapabilityDemoPane
          scenario={scenario}
          loading={false}
          error={null}
          capabilityBundle={capabilityBundle}
          files={[]}
          executionMode="batch"
          onExecutionModeChange={() => {}}
          clientTools={[]}
          onEffects={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Preparing the demo workspace...");
    expect(container.querySelector("[data-testid='mock-chatkit-mounted']")).toBeNull();

    await act(async () => {
      root.render(
        <CapabilityDemoPane
          scenario={scenario}
          loading={false}
          error={null}
          capabilityBundle={capabilityBundle}
          files={[demoSeedFile]}
          executionMode="batch"
          onExecutionModeChange={() => {}}
          clientTools={[]}
          onEffects={() => {}}
        />,
      );
    });

    expect(container.querySelector("[data-testid='mock-chatkit-empty']")).toBeNull();
    expect(container.querySelector("[data-testid='mock-chatkit-mounted']")).not.toBeNull();
  });

  it("can suppress inline demo notes and pass compact chat chrome controls through", async () => {
    await act(async () => {
      root.render(
        <CapabilityDemoPane
          scenario={{
            ...scenario,
            expectedOutcomes: ["Keep the walkthrough concise."],
            notes: ["Prefer the scripted path first."],
          }}
          loading={false}
          error={null}
          capabilityBundle={capabilityBundle}
          files={[demoSeedFile]}
          executionMode="batch"
          onExecutionModeChange={() => {}}
          clientTools={[]}
          onEffects={() => {}}
          showScenarioNotes={false}
          showExecutionModeControls={false}
          feedbackButtonVariant="icon"
          showChatKitHeader={false}
        />,
      );
    });

    expect(container.textContent).not.toContain("Demo notes");
    const mounted = container.querySelector("[data-testid='mock-chatkit-mounted']");
    expect(mounted?.getAttribute("data-show-execution-mode-controls")).toBe("false");
    expect(mounted?.getAttribute("data-feedback-variant")).toBe("icon");
    expect(mounted?.getAttribute("data-show-chatkit-header")).toBe("false");
  });
});
