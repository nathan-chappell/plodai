// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDemoScenario } from "../useDemoScenario";
import type { CapabilityDemoScenario } from "../../types";
import type { ClientEffect, ExecutionMode } from "../../../types/analysis";
import type { LocalWorkspaceFile } from "../../../types/report";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const DEMO_FILE: LocalWorkspaceFile = {
  id: "demo-csv",
  name: "demo.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 12,
  row_count: 1,
  columns: ["region"],
  numeric_columns: [],
  sample_rows: [{ region: "West" }],
  preview_rows: [{ region: "West" }],
  rows: [{ region: "West" }],
};

const DEMO_SCENARIO: CapabilityDemoScenario = {
  id: "demo-scenario",
  title: "Demo scenario",
  summary: "Test scenario",
  initialPrompt: "Run the demo.",
  workspaceSeed: [DEMO_FILE],
  defaultExecutionMode: "batch",
  expectedOutcomes: ["Loads once"],
};

function DemoScenarioHarness({
  buildDemoScenario,
  ready = true,
}: {
  buildDemoScenario: () => CapabilityDemoScenario | Promise<CapabilityDemoScenario>;
  ready?: boolean;
}) {
  const [files, setFiles] = useState<LocalWorkspaceFile[]>([]);
  const [status, setStatus] = useState("");
  const [reportEffects, setReportEffects] = useState<ClientEffect[]>([
    {
      type: "report_section_appended",
      title: "Before reset",
      markdown: "seed",
    },
  ]);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("interactive");
  const { scenario, loading, error } = useDemoScenario({
    active: true,
    capabilityId: "csv-agent",
    ready,
    buildDemoScenario,
    setFiles: (nextFiles) => {
      setFiles(nextFiles);
    },
    setStatus: (value) => {
      setStatus(value);
    },
    setReportEffects: (value) => {
      setReportEffects(value);
    },
    setExecutionMode: (value) => {
      setExecutionMode(value);
    },
  });

  return (
    <div
      data-error={error ?? ""}
      data-file-count={String(files.length)}
      data-loading={String(loading)}
      data-mode={executionMode}
      data-report-effects={String(reportEffects.length)}
      data-scenario={scenario?.id ?? ""}
      data-status={status}
    />
  );
}

describe("useDemoScenario", () => {
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
    vi.restoreAllMocks();
  });

  it("loads an active demo scenario only once even as hook state updates rerender the component", async () => {
    const buildDemoScenario = vi.fn(async () => DEMO_SCENARIO);

    await act(async () => {
      root.render(<DemoScenarioHarness buildDemoScenario={buildDemoScenario} />);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    const host = container.firstElementChild as HTMLElement | null;
    expect(buildDemoScenario).toHaveBeenCalledTimes(1);
    expect(host?.dataset.loading).toBe("false");
    expect(host?.dataset.scenario).toBe(DEMO_SCENARIO.id);
    expect(host?.dataset.fileCount).toBe("1");
    expect(host?.dataset.mode).toBe("batch");
    expect(host?.dataset.reportEffects).toBe("0");
  });

  it("waits for workspace readiness before building the demo scenario", async () => {
    const buildDemoScenario = vi.fn(async () => DEMO_SCENARIO);

    await act(async () => {
      root.render(<DemoScenarioHarness buildDemoScenario={buildDemoScenario} ready={false} />);
    });

    const initialHost = container.firstElementChild as HTMLElement | null;
    expect(buildDemoScenario).not.toHaveBeenCalled();
    expect(initialHost?.dataset.loading).toBe("true");
    expect(initialHost?.dataset.fileCount).toBe("0");

    await act(async () => {
      root.render(<DemoScenarioHarness buildDemoScenario={buildDemoScenario} ready />);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    const hydratedHost = container.firstElementChild as HTMLElement | null;
    expect(buildDemoScenario).toHaveBeenCalledTimes(1);
    expect(hydratedHost?.dataset.loading).toBe("false");
    expect(hydratedHost?.dataset.scenario).toBe(DEMO_SCENARIO.id);
    expect(hydratedHost?.dataset.fileCount).toBe("1");
  });
});
