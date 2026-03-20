// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppStateProvider } from "../../app/context";
import { WorkspaceProvider } from "../../app/workspace";
import { useCapabilityFileWorkspace } from "../fileWorkspace";
import type { AuthUser } from "../../types/auth";
import {
  createWorkspaceFilesystem,
  createWorkspaceRegistry,
  loadWorkspaceFilesystem,
  loadWorkspaceRegistry,
  loadWorkspaceSurfaceState,
  saveWorkspaceFilesystem,
  saveWorkspaceRegistry,
  saveWorkspaceSurfaceState,
} from "../../lib/workspace-fs";
import { loadCapabilityWorkspace } from "../../lib/workspace-store";

vi.mock("../../lib/workspace-fs", async () => {
  const actual = await vi.importActual<typeof import("../../lib/workspace-fs")>("../../lib/workspace-fs");
  return {
    ...actual,
    loadWorkspaceFilesystem: vi.fn(),
    loadWorkspaceRegistry: vi.fn(),
    loadWorkspaceSurfaceState: vi.fn(),
    saveWorkspaceFilesystem: vi.fn(),
    saveWorkspaceRegistry: vi.fn(),
    saveWorkspaceSurfaceState: vi.fn(),
  };
});

vi.mock("../../lib/workspace-store", async () => {
  const actual = await vi.importActual<typeof import("../../lib/workspace-store")>("../../lib/workspace-store");
  return {
    ...actual,
    loadCapabilityWorkspace: vi.fn(),
  };
});

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  full_name: "Test User",
  role: "user",
  is_active: true,
  current_credit_usd: 10,
  credit_floor_usd: -1,
};

function ReportWorkspaceHarness() {
  const workspace = useCapabilityFileWorkspace({
    capabilityId: "report-agent",
    capabilityTitle: "Report Agent",
    defaultStatus: "Ready.",
    defaultBrief: "Investigate the workspace.",
    defaultTab: "report",
    allowedTabs: ["report", "reports", "demo"],
  });

  return (
    <div
      data-hydrated={String(workspace.workspaceHydrated)}
      data-tab={workspace.activeWorkspaceTab}
      data-workspace-id={workspace.selectedWorkspaceId}
      data-workspace-kind={workspace.selectedWorkspaceKind}
    >
      <button onClick={() => workspace.setActiveWorkspaceTab("demo")} type="button">
        Open demo
      </button>
      <button onClick={() => workspace.setActiveWorkspaceTab("report")} type="button">
        Open report
      </button>
    </div>
  );
}

describe("useCapabilityFileWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.mocked(loadCapabilityWorkspace).mockResolvedValue(null);
    vi.mocked(loadWorkspaceRegistry).mockResolvedValue(createWorkspaceRegistry());
    vi.mocked(loadWorkspaceFilesystem).mockResolvedValue(createWorkspaceFilesystem());
    vi.mocked(loadWorkspaceSurfaceState).mockResolvedValue(null);
    vi.mocked(saveWorkspaceFilesystem).mockResolvedValue(undefined);
    vi.mocked(saveWorkspaceRegistry).mockResolvedValue(undefined);
    vi.mocked(saveWorkspaceSurfaceState).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderHarness() {
    await act(async () => {
      root.render(
        <AppStateProvider
          value={{
            user,
            setUser: () => user,
            authError: null,
            setAuthError: () => null,
          }}
        >
          <WorkspaceProvider>
            <ReportWorkspaceHarness />
          </WorkspaceProvider>
        </AppStateProvider>,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });
  }

  it("switches into the shared demo workspace and restores the previous workspace when leaving demo", async () => {
    await renderHarness();

    const harness = container.firstElementChild as HTMLElement | null;
    const buttons = Array.from(container.querySelectorAll("button"));
    const openDemoButton = buttons.find((button) => button.textContent === "Open demo");
    const openReportButton = buttons.find((button) => button.textContent === "Open report");

    expect(harness?.dataset.workspaceKind).toBe("default");
    expect(harness?.dataset.tab).toBe("report");

    await act(async () => {
      openDemoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    expect(harness?.dataset.workspaceKind).toBe("demo");
    expect(harness?.dataset.tab).toBe("demo");

    await act(async () => {
      openReportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    expect(harness?.dataset.workspaceKind).toBe("default");
    expect(harness?.dataset.tab).toBe("report");
  });

  it("normalizes incompatible stored tabs for the current capability surface", async () => {
    vi.mocked(loadWorkspaceSurfaceState).mockImplementation(async (_userId, workspaceId) => ({
      surface_key: "report-agent",
      active_prefix: `/${workspaceId}/`,
      active_tab: "agent",
    }));

    await renderHarness();

    const harness = container.firstElementChild as HTMLElement | null;
    expect(harness?.dataset.workspaceKind).toBe("default");
    expect(harness?.dataset.tab).toBe("report");
  });
});
