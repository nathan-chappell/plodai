// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformShell } from "../PlatformShell";
import type { CapabilityDefinition, ShellWorkspaceRegistration } from "../../capabilities/types";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const capabilities: CapabilityDefinition[] = [
  {
    id: "csv-agent",
    path: "/capabilities/csv-agent",
    navLabel: "CSV Agent",
    title: "CSV Agent",
    eyebrow: "Capability",
    description: "Structured CSV analysis and chartable artifact creation.",
    chatkitLead: "Perform queries and make slices of CSV files.",
    chatkitPlaceholder: "Ask the CSV agent to inspect schemas, run aggregates, or materialize CSV and JSON results",
    tabs: [{ id: "agent", label: "Agent" }],
  },
];

const workspaceRegistration: ShellWorkspaceRegistration = {
  capabilityId: "csv-agent",
  title: "Workspace artifacts",
  description: "Artifacts for the active capability.",
  artifacts: [],
  workspaces: [
    {
      id: "default",
      name: "Default workspace",
      kind: "default",
      created_at: "2026-03-19T00:00:00.000Z",
    },
  ],
  activeWorkspaceId: "default",
  activeWorkspaceName: "Default workspace",
  activeWorkspaceKind: "default",
  accept: ".csv",
  onSelectFiles: vi.fn(async () => {}),
  onSelectWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
  onClearWorkspace: vi.fn(),
  clearActionLabel: "Clear workspace",
};

describe("PlatformShell", () => {
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

  it("removes browse/theme sidebar sections and keeps a lowercase workspace utility entry", async () => {
    await act(async () => {
      root.render(
        <PlatformShell
          capabilities={capabilities}
          activeCapabilityId="csv-agent"
          onSelectCapability={() => {}}
          workspaceRegistration={workspaceRegistration}
          workspaceModalOpen={false}
          onOpenWorkspaceModal={() => {}}
          onCloseWorkspaceModal={() => {}}
        >
          <div>child content</div>
        </PlatformShell>,
      );
    });

    expect(container.textContent).not.toContain("Browse");
    expect(container.textContent).not.toContain("Theme");
    expect(container.querySelector("[data-testid='workspace-nav-button']")?.textContent).toContain("workspace");
  });
});
