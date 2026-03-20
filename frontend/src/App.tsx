import { Suspense, lazy, useCallback, useState, type ComponentType, type LazyExoticComponent } from "react";

import { AppStateProvider } from "./app/context";
import { WorkspaceProvider } from "./app/workspace";
import { useAppRouteGuards, useAppSessionState, useToastState } from "./app/hooks";
import {
  AppEmptyMetaText,
  AppEmptyState,
  ToastCard,
  ToastDismissButton,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "./app/styles";
import { PlatformShell } from "./components/PlatformShell";
import { SignInPage } from "./components/SignInPage";
import { allCapabilityDefinitions } from "./capabilities/definitions";
import type { ShellWorkspaceRegistration } from "./capabilities/types";
import { navigate, usePathname } from "./lib/router";
import { isLegacyBlogPath, isWritingPath } from "./lib/writing";

type CapabilityPageProps = {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
};

type CapabilityPageComponent = ComponentType<CapabilityPageProps>;

const WritingPage = lazy(async () => {
  const module = await import("./components/WritingPage");
  return { default: module.WritingPage };
});

const WorkspaceAgentPage = lazy(async () => {
  const module = await import("./capabilities/workspaceAgent");
  return { default: module.WorkspaceAgentPage };
});

const AdminUsersPage = lazy(async () => {
  const module = await import("./capabilities/adminUsers");
  const WrappedAdminUsersPage: CapabilityPageComponent = () => <module.AdminUsersPage />;
  return { default: WrappedAdminUsersPage };
});

const capabilityPages: Record<string, LazyExoticComponent<CapabilityPageComponent>> = {
  "workspace-agent": WorkspaceAgentPage,
  "admin-users": AdminUsersPage,
};

function RouteLoadingState({ label }: { label: string }) {
  return (
    <AppEmptyState>
      <strong>Loading {label}</strong>
      <AppEmptyMetaText>Fetching just the code needed for this workspace route.</AppEmptyMetaText>
    </AppEmptyState>
  );
}

function filterCapabilities(role: "admin" | "user") {
  return allCapabilityDefinitions.filter((capability) =>
    capability.showInSidebar !== false &&
    (capability.tabs.length === 0 ||
      capability.tabs.some((tab) => (tab.visible ? tab.visible({ role }) : true))),
  );
}

function resolveVisibleCapability(pathname: string, role: "admin" | "user") {
  const capabilities = filterCapabilities(role);
  return capabilities.find((capability) => capability.path === pathname) ?? null;
}

export function App() {
  const pathname = usePathname();
  const { authError, hydrating, isSignedIn, reloadSession, setAuthError, user, setUser } = useAppSessionState();
  const { dismissToast, toasts } = useToastState();
  const viewingWriting = isWritingPath(pathname) || isLegacyBlogPath(pathname);
  const [workspaceRegistration, setWorkspaceRegistration] = useState<ShellWorkspaceRegistration | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const handleRegisterWorkspace = useCallback((registration: ShellWorkspaceRegistration | null) => {
    setWorkspaceRegistration(registration);
  }, []);
  const handleSelectCapability = useCallback((path: string) => {
    setWorkspaceModalOpen(false);
    navigate(path);
  }, []);
  const handleOpenWorkspaceModal = useCallback(() => {
    setWorkspaceModalOpen(true);
  }, []);
  const handleCloseWorkspaceModal = useCallback(() => {
    setWorkspaceModalOpen(false);
  }, []);

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

  if (viewingWriting) {
    return (
      <>
        <Suspense fallback={<RouteLoadingState label="writing" />}>
          <WritingPage />
        </Suspense>
        <ToastViewport>
          {toasts.map((toast) => (
            <ToastCard key={toast.id} $tone={toast.tone}>
              <ToastHeader>
                <ToastTitle>{toast.title}</ToastTitle>
                <ToastDismissButton onClick={() => dismissToast(toast.id)} type="button">
                  Dismiss
                </ToastDismissButton>
              </ToastHeader>
              <AppEmptyMetaText>{toast.message}</AppEmptyMetaText>
            </ToastCard>
          ))}
        </ToastViewport>
      </>
    );
  }

  if (hydrating) {
    return (
      <AppEmptyState>
        <strong>Loading session</strong>
        <AppEmptyMetaText>Checking whether you already have an authenticated workspace session.</AppEmptyMetaText>
      </AppEmptyState>
    );
  }

  if (!user) {
    return <SignInPage authError={authError} hasClerkSession={isSignedIn} onRetryAuth={reloadSession} />;
  }
  const currentUser = user;
  const capabilities = filterCapabilities(currentUser.role);
  const activeCapability = resolveVisibleCapability(pathname, currentUser.role);
  const ActiveCapabilityPage = activeCapability ? capabilityPages[activeCapability.id] : null;
  return (
    <AppStateProvider value={{ authError, setAuthError, user: currentUser, setUser }}>
      <WorkspaceProvider>
        <PlatformShell
          capabilities={capabilities}
          activeCapabilityId={activeCapability?.id ?? null}
          onSelectCapability={handleSelectCapability}
          workspaceRegistration={workspaceRegistration}
          workspaceModalOpen={workspaceModalOpen}
          onOpenWorkspaceModal={handleOpenWorkspaceModal}
          onCloseWorkspaceModal={handleCloseWorkspaceModal}
        >
          {!activeCapability ? (
            <AppEmptyState>
              <strong>Unknown route</strong>
              <AppEmptyMetaText>Open the workspace or admin tools from the shell navigation.</AppEmptyMetaText>
            </AppEmptyState>
          ) : null}
          {activeCapability && ActiveCapabilityPage ? (
            <Suspense fallback={<RouteLoadingState label={activeCapability.title} />}>
              <ActiveCapabilityPage
                onRegisterWorkspace={handleRegisterWorkspace}
              />
            </Suspense>
          ) : null}
        </PlatformShell>
      </WorkspaceProvider>
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} $tone={toast.tone}>
            <ToastHeader>
              <ToastTitle>{toast.title}</ToastTitle>
              <ToastDismissButton onClick={() => dismissToast(toast.id)} type="button">
                Dismiss
              </ToastDismissButton>
            </ToastHeader>
            <AppEmptyMetaText>{toast.message}</AppEmptyMetaText>
          </ToastCard>
        ))}
      </ToastViewport>
    </AppStateProvider>
  );
}
