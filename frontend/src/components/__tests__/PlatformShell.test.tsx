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
    id: "agriculture-agent",
    path: "/agriculture",
    navLabel: "Agriculture",
    title: "Agriculture",
    eyebrow: "App",
    description: "Inspect plant photos and draft practical next steps.",
    chatkitLead: "Inspect plant photos and summarize visible evidence.",
    chatkitPlaceholder: "Ask the agriculture app to inspect plant photos",
    tabs: [],
    attachmentConfig: {
      enabled: true,
    },
  },
  {
    id: "admin-users",
    path: "/admin",
    navLabel: "Admin",
    title: "Admin",
    eyebrow: "Admin",
    description: "Manage users and test cases.",
    chatkitLead: "Review users.",
    chatkitPlaceholder: "Ask about users",
    tabs: [],
    attachmentConfig: {
      enabled: false,
    },
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

  it("shows the branded chrome with the current themed app name", async () => {
    await act(async () => {
      root.render(
        <PlatformShell
          agents={agents}
          activeAgentId="agriculture-agent"
          themeAgentId="document-agent"
          onSelectAgent={() => {}}
        >
          <div>child content</div>
        </PlatformShell>,
      );
    });

    expect(container.textContent).toContain("AI Portfolio");
    expect(container.textContent).toContain("Documents");
    expect(container.textContent).not.toContain("Workspace");
    expect(container.querySelector("[data-testid='auth-panel']")).not.toBeNull();
  });
});
