// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DocumentBrowserPanel,
  WorkspaceBrowserPanel,
} from "../workspaceApp";
import type { WorkspaceListItem } from "../../types/workspace";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const workspaces: WorkspaceListItem[] = [
  {
    id: "workspace_agriculture",
    app_id: "agriculture",
    name: "Orchard",
    active_chat_id: null,
    selected_item_id: null,
    current_report_item_id: null,
    item_count: 0,
    created_at: "2026-03-23T00:00:00.000Z",
    updated_at: "2026-03-23T00:00:00.000Z",
  },
];

describe("workspace app browsers", () => {
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

  it("does not render a direct upload button for the agriculture workspace browser", async () => {
    await act(async () => {
      root.render(
        <WorkspaceBrowserPanel
          activeWorkspaceId="workspace_agriculture"
          artifacts={[]}
          workspaces={workspaces}
          onClear={() => undefined}
          onCreateWorkspace={() => undefined}
          onSelectWorkspace={() => undefined}
          onSelectItem={() => undefined}
          emptyUploadsMessage="Add plant photos from the chat composer to populate this workspace."
          files={[]}
          selectedItem={null}
        />,
      );
    });

    expect(container.textContent).toContain("New workspace");
    expect(container.textContent).not.toContain("Upload file");
    expect(container.textContent).not.toContain("Uploads");
    expect(container.textContent).not.toContain("Created");
    expect(
      container.querySelector("[data-testid='workspace-file-input']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-inventory-tabs']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-inventory-summary']")?.textContent,
    ).toContain("Stuff");
    expect(container.textContent).toContain(
      "Add plant photos from the chat composer to populate this workspace.",
    );
  });

  it("keeps the document upload controls available", async () => {
    await act(async () => {
      root.render(
        <DocumentBrowserPanel
          activeThreadId={null}
          activeWorkspaceId="workspace_agriculture"
          documentFiles={[]}
          onCreateWorkspace={() => undefined}
          onDeleteFile={async () => undefined}
          onImportUrl={async () => undefined}
          onOpenFile={async () => undefined}
          onRefresh={async () => undefined}
          onSelectWorkspace={() => undefined}
          onUploadFiles={async () => undefined}
          workspaces={[
            {
              ...workspaces[0],
              app_id: "documents",
              id: "workspace_documents",
              name: "Documents",
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Upload documents");
  });
});
