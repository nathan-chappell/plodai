import { Suspense, lazy, useState, type ComponentType, type LazyExoticComponent } from "react";

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
import { isBlogPath } from "./lib/blog";
import { navigate, usePathname } from "./lib/router";

type CapabilityPageProps = {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
};

type CapabilityPageComponent = ComponentType<CapabilityPageProps>;

const BlogPage = lazy(async () => {
  const module = await import("./components/BlogPage");
  return { default: module.BlogPage };
});

const ReportFoundryPage = lazy(async () => {
  const module = await import("./capabilities/reportFoundry");
  return { default: module.ReportFoundryPage };
});

const CsvAgentPage = lazy(async () => {
  const module = await import("./capabilities/csvAgent");
  return { default: module.CsvAgentPage };
});

const ChartAgentPage = lazy(async () => {
  const module = await import("./capabilities/chartAgent");
  return { default: module.ChartAgentPage };
});

const PdfAgentPage = lazy(async () => {
  const module = await import("./capabilities/pdfAgent");
  return { default: module.PdfAgentPage };
});

const AdminUsersPage = lazy(async () => {
  const module = await import("./capabilities/adminUsers");
  const WrappedAdminUsersPage: CapabilityPageComponent = () => <module.AdminUsersPage />;
  return { default: WrappedAdminUsersPage };
});

const capabilityPages: Record<string, LazyExoticComponent<CapabilityPageComponent>> = {
  "report-agent": ReportFoundryPage,
  "csv-agent": CsvAgentPage,
  "chart-agent": ChartAgentPage,
  "pdf-agent": PdfAgentPage,
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
    capability.tabs.some((tab) => (tab.visible ? tab.visible({ role }) : true)),
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
  const viewingBlog = isBlogPath(pathname);
  const [workspaceRegistration, setWorkspaceRegistration] = useState<ShellWorkspaceRegistration | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);

  useAppRouteGuards({
    authError,
    pathname,
    user,
    hydrating,
  });

  if (viewingBlog) {
    return (
      <>
        <Suspense fallback={<RouteLoadingState label="blog post" />}>
          <BlogPage pathname={pathname} viewerRole={user?.role ?? null} />
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
          currentPathname={pathname}
          onSelectCapability={(path) => {
            setWorkspaceModalOpen(false);
            navigate(path);
          }}
          workspaceRegistration={workspaceRegistration}
          workspaceModalOpen={workspaceModalOpen}
          onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
          onCloseWorkspaceModal={() => setWorkspaceModalOpen(false)}
        >
          {!activeCapability ? (
            <AppEmptyState>
              <strong>Unknown route</strong>
              <AppEmptyMetaText>Pick one of the registered capabilities from the shell navigation.</AppEmptyMetaText>
            </AppEmptyState>
          ) : null}
          {activeCapability && ActiveCapabilityPage ? (
            <Suspense fallback={<RouteLoadingState label={activeCapability.title} />}>
              <ActiveCapabilityPage
                onRegisterWorkspace={(registration) => {
                  setWorkspaceRegistration(registration);
                }}
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
