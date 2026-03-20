// @vitest-environment jsdom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppStateProvider } from "../context";
import { WorkspaceProvider, useWorkspaceSurface } from "../workspace";
import { writeWorkspaceTextFile } from "../../lib/workspace-contract";
import type { AuthUser } from "../../types/auth";
import type { WorkspaceFilesystem } from "../../types/workspace";
import {
  createWorkspaceRegistry,
  createWorkspaceFilesystem,
  loadWorkspaceFilesystem,
  loadWorkspaceRegistry,
  loadWorkspaceSurfaceState,
  saveWorkspaceFilesystem,
  saveWorkspaceRegistry,
  saveWorkspaceSurfaceState,
} from "../../lib/workspace-fs";
import type { LocalWorkspaceFile } from "../../types/report";

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

const demoFile: LocalWorkspaceFile = {
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

function WorkspaceSurfaceHarness() {
  const workspace = useWorkspaceSurface({
    surfaceKey: "csv-agent",
    defaultCwdPath: "/csv-agent",
  });

  useEffect(() => {
    function handleRun() {
      workspace.updateFilesystem((filesystem) =>
        writeWorkspaceTextFile(filesystem, "/csv-agent/meta/notes.txt", "meta", "derived"),
      );
      workspace.appendFiles([demoFile], "demo");
    }

    window.addEventListener("workspace-test-run", handleRun);
    return () => {
      window.removeEventListener("workspace-test-run", handleRun);
    };
  }, [workspace]);

  return (
    <div
      data-files={workspace.files.map((file) => file.id).join(",")}
      data-items={Object.keys(workspace.filesystem.files_by_path).sort().join("|")}
      data-hydrated={String(workspace.hydrated)}
      data-surface-hydrated={String(workspace.surfaceHydrated)}
    />
  );
}

describe("WorkspaceProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(saveWorkspaceFilesystem).mockResolvedValue(undefined);
    vi.mocked(loadWorkspaceRegistry).mockResolvedValue(createWorkspaceRegistry());
    vi.mocked(loadWorkspaceSurfaceState).mockResolvedValue(null);
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

  it("does not persist workspace data before hydration completes", async () => {
    const deferred = createDeferred<WorkspaceFilesystem>();
    vi.mocked(loadWorkspaceFilesystem).mockReturnValue(deferred.promise);

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
            <div>workspace</div>
          </WorkspaceProvider>
        </AppStateProvider>,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(saveWorkspaceFilesystem).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(createWorkspaceFilesystem());
      await deferred.promise;
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(saveWorkspaceFilesystem).toHaveBeenCalledTimes(2);
    expect(saveWorkspaceFilesystem).toHaveBeenCalledWith(
      user.id,
      "default",
      expect.objectContaining({ files_by_path: expect.any(Object) }),
    );
    expect(saveWorkspaceRegistry).toHaveBeenCalledTimes(1);
  });

  it("preserves adjacent workspace updates while appending new artifacts", async () => {
    vi.mocked(loadWorkspaceFilesystem).mockResolvedValue(createWorkspaceFilesystem());

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
            <WorkspaceSurfaceHarness />
          </WorkspaceProvider>
        </AppStateProvider>,
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const harness = container.firstElementChild as HTMLElement | null;
    expect(harness?.dataset.hydrated).toBe("true");

    await act(async () => {
      const event = new CustomEvent("workspace-test-run");
      window.dispatchEvent(event);
    });

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(harness?.dataset.files).toContain("demo-csv");
    expect(harness?.dataset.items).toContain("/csv-agent/demo.csv");
    expect(harness?.dataset.items).toContain("/csv-agent/meta/notes.txt");
  });
});
