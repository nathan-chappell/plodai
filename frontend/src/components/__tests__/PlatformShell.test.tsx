// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformShell } from "../PlatformShell";
import type { AgentDefinition } from "../../agents/types";

vi.mock("../AuthPanel", () => ({
  AuthPanel: () => <div data-testid="auth-panel">Auth</div>,
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const agents: AgentDefinition[] = [
  {
    id: "help-agent",
    path: "/workspace",
    navLabel: "Workspace",
    title: "Workspace",
    eyebrow: "Workspace",
    description: "App orientation and demo launches.",
    chatkitLead: "Explain the workspace and launch demos.",
    chatkitPlaceholder: "Ask what this app can do",
    tabs: [],
  },
  {
    id: "admin-users",
    path: "/admin/users",
    navLabel: "Admin",
    title: "Admin",
    eyebrow: "Admin",
    description: "Manage users.",
    chatkitLead: "Review users.",
    chatkitPlaceholder: "Ask about users",
    tabs: [],
  },
];

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

  it("shows a generic workspace shell without the surface selector", async () => {
    await act(async () => {
      root.render(
        <PlatformShell
          agents={agents}
          activeAgentId="help-agent"
          onSelectAgent={() => {}}
        >
          <div>child content</div>
        </PlatformShell>,
      );
    });

    expect(container.textContent).not.toContain("Browse");
    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).not.toContain("Select an agent inside the workspace shell");
    expect(container.querySelector("[data-testid='workspace-feedback-button']")).toBeNull();
    expect(container.textContent).not.toContain("Files");
    expect(container.querySelector("[data-testid='workspace-surface-selector']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-surface-selector-mobile']")).toBeNull();
  });
});
