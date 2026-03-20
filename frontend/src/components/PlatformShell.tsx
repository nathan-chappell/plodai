import { type ReactNode } from "react";

import type { ToolProviderDefinition, WorkspaceSurfaceRegistration } from "../tools/types";
import { WorkspaceInventoryPane } from "./WorkspaceInventoryPane";
import { usePlatformShellState } from "./hooks";
import { PlatformThemeProvider } from "./platformTheme";
import {
  PlatformBrandBlock,
  PlatformCollapseButton,
  PlatformEyebrow,
  PlatformLayout,
  PlatformMain,
  PlatformNavButton,
  PlatformNavGlyph,
  PlatformNavGrid,
  PlatformNavLabel,
  PlatformNavMeta,
  PlatformPage,
  PlatformSidebar,
  PlatformSidebarHeader,
  PlatformSidebarPrimary,
  PlatformSubhead,
  PlatformTitle,
  WorkspaceModalBackdrop,
  WorkspaceModalCard,
  WorkspaceModalCloseButton,
  WorkspaceModalHeader,
  WorkspaceModalMeta,
  WorkspaceModalTitle,
  WorkspaceModalTitleBlock,
} from "./styles";

function WorkspaceIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M3.25 6.75a1.5 1.5 0 0 1 1.5-1.5h3.1c.4 0 .77.16 1.06.44l.9.9c.28.28.66.44 1.06.44h4.37a1.5 1.5 0 0 1 1.5 1.5v5.67a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5V6.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M3.75 8.5h12.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function PlatformShell({
  capabilities,
  activeCapabilityId,
  onSelectCapability,
  workspaceRegistration,
  workspaceModalOpen,
  onOpenWorkspaceModal,
  onCloseWorkspaceModal,
  children,
}: {
  capabilities: ToolProviderDefinition[];
  activeCapabilityId: string | null;
  onSelectCapability: (path: string) => void;
  workspaceRegistration: WorkspaceSurfaceRegistration | null;
  workspaceModalOpen: boolean;
  onOpenWorkspaceModal: () => void;
  onCloseWorkspaceModal: () => void;
  children: ReactNode;
}) {
  const { collapsed, setCollapsed } = usePlatformShellState();
  const agentCapabilities = capabilities.filter((capability) => capability.id !== "admin-users");
  const adminCapability = capabilities.find((capability) => capability.id === "admin-users") ?? null;

  return (
    <PlatformThemeProvider>
      <PlatformPage>
        <PlatformLayout $collapsed={collapsed}>
          <PlatformSidebar>
            <PlatformSidebarHeader $collapsed={collapsed}>
              <PlatformBrandBlock $collapsed={collapsed}>
                <PlatformEyebrow>Analysis Workspace</PlatformEyebrow>
                <PlatformTitle>AI Portfolio</PlatformTitle>
                <PlatformSubhead>Tool-led analysis workspace.</PlatformSubhead>
              </PlatformBrandBlock>
              <PlatformCollapseButton
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setCollapsed((current) => !current)}
                type="button"
              >
                {collapsed ? ">" : "<"}
              </PlatformCollapseButton>
            </PlatformSidebarHeader>

            <PlatformSidebarPrimary>
              <PlatformNavGrid>
                {agentCapabilities.map((capability) => (
                  <PlatformNavButton
                    key={capability.id}
                    data-testid={`capability-nav-${capability.id}`}
                    $active={capability.id === activeCapabilityId}
                    $collapsed={collapsed}
                    onClick={() => onSelectCapability(capability.path)}
                    type="button"
                    title={capability.navLabel}
                  >
                    <PlatformNavGlyph $active={capability.id === activeCapabilityId} />
                    <PlatformNavLabel $collapsed={collapsed}>{capability.navLabel}</PlatformNavLabel>
                    <PlatformNavMeta $collapsed={collapsed}>{capability.description}</PlatformNavMeta>
                  </PlatformNavButton>
                ))}
                {workspaceRegistration ? (
                  <PlatformNavButton
                    $active={workspaceModalOpen}
                    $collapsed={collapsed}
                    data-testid="workspace-nav-button"
                    onClick={onOpenWorkspaceModal}
                    type="button"
                    title="files"
                  >
                    <PlatformNavGlyph $active={workspaceModalOpen}>
                      <WorkspaceIcon />
                    </PlatformNavGlyph>
                    <PlatformNavLabel $collapsed={collapsed}>files</PlatformNavLabel>
                    <PlatformNavMeta $collapsed={collapsed}>
                      {workspaceRegistration.activeWorkspaceName}
                    </PlatformNavMeta>
                  </PlatformNavButton>
                ) : null}
                {adminCapability ? (
                  <PlatformNavButton
                    data-testid={`capability-nav-${adminCapability.id}`}
                    $active={adminCapability.id === activeCapabilityId}
                    $collapsed={collapsed}
                    onClick={() => onSelectCapability(adminCapability.path)}
                    type="button"
                    title={adminCapability.navLabel}
                  >
                    <PlatformNavGlyph $active={adminCapability.id === activeCapabilityId} />
                    <PlatformNavLabel $collapsed={collapsed}>{adminCapability.navLabel}</PlatformNavLabel>
                    <PlatformNavMeta $collapsed={collapsed}>{adminCapability.description}</PlatformNavMeta>
                  </PlatformNavButton>
                ) : null}
              </PlatformNavGrid>
            </PlatformSidebarPrimary>
          </PlatformSidebar>

          <PlatformMain>{children}</PlatformMain>
        </PlatformLayout>
        {workspaceRegistration && workspaceModalOpen ? (
          <WorkspaceModalBackdrop onClick={onCloseWorkspaceModal}>
            <WorkspaceModalCard onClick={(event) => event.stopPropagation()}>
              <WorkspaceModalHeader>
                <WorkspaceModalTitleBlock>
                  <PlatformEyebrow>Workspace</PlatformEyebrow>
                  <WorkspaceModalTitle>{workspaceRegistration.title}</WorkspaceModalTitle>
                  <WorkspaceModalMeta>{workspaceRegistration.description}</WorkspaceModalMeta>
                </WorkspaceModalTitleBlock>
                <WorkspaceModalCloseButton onClick={onCloseWorkspaceModal} type="button">
                  Close
                </WorkspaceModalCloseButton>
              </WorkspaceModalHeader>
              <WorkspaceInventoryPane
                artifacts={workspaceRegistration.artifacts}
                smartSplitBundles={workspaceRegistration.smartSplitBundles}
                workspaces={workspaceRegistration.workspaces}
                activeWorkspaceId={workspaceRegistration.activeWorkspaceId}
                activeWorkspaceName={workspaceRegistration.activeWorkspaceName}
                activeWorkspaceKind={workspaceRegistration.activeWorkspaceKind}
                accept={workspaceRegistration.accept}
                onSelectFiles={workspaceRegistration.onSelectFiles}
                onSelectWorkspace={workspaceRegistration.onSelectWorkspace}
                onCreateWorkspace={workspaceRegistration.onCreateWorkspace}
                onClearWorkspace={workspaceRegistration.onClearWorkspace}
                clearActionLabel={workspaceRegistration.clearActionLabel}
                clearActionDisabled={workspaceRegistration.clearActionDisabled}
                onRemoveArtifact={workspaceRegistration.onRemoveArtifact}
              />
            </WorkspaceModalCard>
          </WorkspaceModalBackdrop>
        ) : null}
      </PlatformPage>
    </PlatformThemeProvider>
  );
}
