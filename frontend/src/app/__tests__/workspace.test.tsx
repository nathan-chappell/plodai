// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalWorkspaceFile } from "../../types/report";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const {
  buildWorkspaceFileMock,
  loadActiveWorkspaceContextIdMock,
  loadWorkspaceContextsMock,
  saveActiveWorkspaceContextIdMock,
  saveWorkspaceContextsMock,
} = vi.hoisted(() => ({
  buildWorkspaceFileMock: vi.fn(),
  loadActiveWorkspaceContextIdMock: vi.fn(async () => "workspace-default"),
  loadWorkspaceContextsMock: vi.fn(async () => [
    {
      id: "workspace-default",
      name: "Workspace",
      selected_agent_id: "default-agent",
      states_by_agent_id: {},
      created_at: "2026-03-21T10:00:00.000Z",
      updated_at: "2026-03-21T10:00:00.000Z",
    },
  ]),
  saveActiveWorkspaceContextIdMock: vi.fn(async () => undefined),
  saveWorkspaceContextsMock: vi.fn(async () => undefined),
}));

vi.mock("../context", () => ({
  useAppState: () => ({
    user: {
      id: "user_123",
    },
  }),
}));

vi.mock("../../lib/agent-shell-store", () => ({
  loadActiveWorkspaceContextId: loadActiveWorkspaceContextIdMock,
  loadWorkspaceContexts: loadWorkspaceContextsMock,
  saveActiveWorkspaceContextId: saveActiveWorkspaceContextIdMock,
  saveWorkspaceContexts: saveWorkspaceContextsMock,
}));

vi.mock("../../lib/workspace-files", () => ({
  buildWorkspaceFile: buildWorkspaceFileMock,
}));

import { WorkspaceProvider, useAgentShell } from "../workspace";

describe("WorkspaceProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestShell: ReturnType<typeof useAgentShell> | null;

  function Probe() {
    latestShell = useAgentShell();
    return <div data-testid="workspace-probe">{latestShell.hydrated ? "ready" : "loading"}</div>;
  }

  async function waitForHydration() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (latestShell?.hydrated) {
        return;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(latestShell?.hydrated).toBe(true);
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latestShell = null;
    buildWorkspaceFileMock.mockReset();
    loadActiveWorkspaceContextIdMock.mockClear();
    loadWorkspaceContextsMock.mockClear();
    saveActiveWorkspaceContextIdMock.mockClear();
    saveWorkspaceContextsMock.mockClear();
    buildWorkspaceFileMock.mockImplementation(async (file: File) => ({
      id: `file-${file.name}`,
      name: file.name,
      kind: "csv",
      extension: "csv",
      byte_size: file.size,
      mime_type: file.type,
      row_count: 1,
      columns: ["region"],
      numeric_columns: [],
      sample_rows: [{ region: "West" }],
      preview_rows: [{ region: "West" }],
      rows: [{ region: "West" }],
    } satisfies LocalWorkspaceFile));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    latestShell = null;
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("creates a fresh named context and can ingest files into it even when another context is active", async () => {
    await act(async () => {
      root.render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      );
    });

    await waitForHydration();

    let reportContextId = "";
    let laterContextId = "";
    await act(async () => {
      reportContextId = latestShell!.createContext({
        agentId: "report-agent",
        name: "Report tour",
      });
      laterContextId = latestShell!.createContext({
        agentId: "default-agent",
        name: "Workspace 2",
      });
    });

    const upload = new File(["region,revenue\nWest,120\n"], "sales.csv", {
      type: "text/csv",
    });

    await act(async () => {
      await latestShell!.handleSelectFiles("report-agent", [upload], {
        contextId: reportContextId,
      });
    });

    const reportContext = latestShell!.contexts.find((context) => context.id === reportContextId);
    const laterContext = latestShell!.contexts.find((context) => context.id === laterContextId);

    expect(reportContext).toMatchObject({
      id: reportContextId,
      name: "Report tour",
      selected_agent_id: "report-agent",
    });
    expect(reportContext?.states_by_agent_id["report-agent"]?.resources).toHaveLength(1);
    expect(reportContext?.states_by_agent_id["report-agent"]?.resources[0]).toMatchObject({
      id: "file-sales.csv",
      owner_agent_id: "report-agent",
      origin: "uploaded",
      kind: "dataset",
      title: "sales.csv",
    });
    expect(laterContext).toMatchObject({
      id: laterContextId,
      name: "Workspace 2",
      selected_agent_id: "default-agent",
    });
    expect(latestShell!.activeContextId).toBe(laterContextId);
    expect(buildWorkspaceFileMock).toHaveBeenCalledWith(upload);
  });
});
