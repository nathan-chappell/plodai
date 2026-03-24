import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";

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
import { allAgentDefinitions } from "./agents/definitions";
import { isFarmOrderPath, navigate, usePathname } from "./lib/router";
import { isWritingPath } from "./lib/writing";
import type { WorkspaceAppId } from "./types/workspace";

type AgentPageProps = Record<string, never>;

type AgentPageComponent = ComponentType<AgentPageProps>;

const WritingPage = lazy(async () => {
  const module = await import("./components/WritingPage");
  return { default: module.WritingPage };
});

const FarmOrderPage = lazy(async () => {
  const module = await import("./components/FarmOrderPage");
  return { default: module.FarmOrderPage };
});

const AgricultureAgentPage = lazy(async () => {
  const module = await import("./agents/workspaceApp");
  return { default: module.AgricultureWorkspacePage };
});

const DocumentAgentPage = lazy(async () => {
  const module = await import("./agents/workspaceApp");
  return { default: module.DocumentWorkspacePage };
});

const AdminUsersPage = lazy(async () => {
  const module = await import("./agents/adminUsers");
  const WrappedAdminUsersPage: AgentPageComponent = () => <module.AdminUsersPage />;
  return { default: WrappedAdminUsersPage };
});

const agentPages: Record<string, LazyExoticComponent<AgentPageComponent>> = {
  "agriculture-agent": AgricultureAgentPage,
  "document-agent": DocumentAgentPage,
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

function filterAgents(role: "admin" | "user") {
  return allAgentDefinitions.filter((agent) =>
    agent.showInSidebar !== false &&
    (agent.tabs.length === 0 ||
      agent.tabs.some((tab) => (tab.visible ? tab.visible({ role }) : true))),
  );
}

function resolveVisibleAgent(pathname: string, role: "admin" | "user") {
  const agents = filterAgents(role);
  return agents.find((agent) => agent.path === pathname) ?? null;
}

function workspaceAppIdForAgent(agentId: string | null): WorkspaceAppId | null {
  if (agentId === "agriculture-agent") {
    return "agriculture";
  }
  if (agentId === "document-agent") {
    return "documents";
  }
  return null;
}

function WorkspaceShellFrame({
  agents,
  activeAgent,
  ActiveAgentPage,
}: {
  agents: ReturnType<typeof filterAgents>;
  activeAgent: ReturnType<typeof resolveVisibleAgent>;
  ActiveAgentPage: LazyExoticComponent<AgentPageComponent> | null;
}) {
  return (
    <PlatformShell
      agents={agents}
      activeAgentId={activeAgent?.id ?? null}
      themeAgentId={activeAgent?.id ?? null}
      onSelectAgent={navigate}
    >
      {!activeAgent ? (
        <AppEmptyState>
          <strong>Unknown route</strong>
          <AppEmptyMetaText>Open the workspace or admin tools from the shell navigation.</AppEmptyMetaText>
        </AppEmptyState>
      ) : null}
      {activeAgent && ActiveAgentPage ? (
        <Suspense fallback={<RouteLoadingState label={activeAgent.title} />}>
          <ActiveAgentPage />
        </Suspense>
      ) : null}
    </PlatformShell>
  );
}

export function App() {
  const pathname = usePathname();
  const { authError, hydrating, isSignedIn, reloadSession, setAuthError, user, setUser } = useAppSessionState();
  const { dismissToast, toasts } = useToastState();
  const viewingWriting = isWritingPath(pathname);
  const viewingPublicFarmOrder = isFarmOrderPath(pathname);

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

  if (viewingWriting || viewingPublicFarmOrder) {
    return (
      <>
        <Suspense fallback={<RouteLoadingState label={viewingWriting ? "writing" : "farm order"} />}>
          {viewingWriting ? <WritingPage /> : <FarmOrderPage />}
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

  const agents = filterAgents(currentUser.role);
  const activeAgent = resolveVisibleAgent(pathname, currentUser.role);
  const activeWorkspaceAppId = workspaceAppIdForAgent(activeAgent?.id ?? null);
  const ActiveAgentPage = activeAgent ? agentPages[activeAgent.id] : null;
  return (
    <AppStateProvider value={{ authError, setAuthError, user: currentUser, setUser }}>
      <WorkspaceProvider appId={activeWorkspaceAppId}>
        <WorkspaceShellFrame
          agents={agents}
          activeAgent={activeAgent}
          ActiveAgentPage={ActiveAgentPage}
        />
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
