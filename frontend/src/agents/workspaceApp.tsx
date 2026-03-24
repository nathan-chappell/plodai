import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { Entity } from "@openai/chatkit";
import styled from "styled-components";

import { publishToast } from "../app/toasts";
import { MetaText } from "../app/styles";
import { useAppState } from "../app/context";
import { useAgentShell } from "../app/workspace";
import { AgricultureFarmPane } from "../components/AgricultureFarmPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { AgentPreviewPane, type PreviewSelection } from "../components/AgentPreviewPane";
import { AuthPanel } from "../components/AuthPanel";
import type { FarmRecordFocusTarget } from "../components/FarmRecordPanel";
import {
  deleteDocumentFile,
  fetchStoredFileBlob,
  listDocumentFiles,
  searchAgricultureEntities,
  uploadStoredFile,
} from "../lib/api";
import { buildAgricultureEntityPreview } from "../lib/agriculture-entities";
import {
  buildStoredFilePreviewFromFile,
  buildWorkspaceFile,
} from "../lib/workspace-files";
import {
  bindClientToolsForAgentBundle,
  buildAgentBundleForRoot,
} from "./runtime-registry";
import {
  agricultureAgentDefinition,
  documentAgentDefinition,
} from "./definitions";
import { AgentPage } from "./styles";
import type { AgentDefinition, AgentRuntimeContext } from "./types";
import type { LocalAttachment } from "../types/report";
import type {
  DocumentFileSummary,
  DocumentImportHeader,
} from "../types/stored-file";
import type {
  WorkspaceAppId,
  WorkspaceCreatedItemSummary,
  WorkspaceUploadItemSummary,
  WorkspaceListItem,
} from "../types/workspace";

const DOCUMENT_STARTER_PROMPTS = [
  {
    label: "Inspect the PDF",
    prompt: "Inspect the current PDF and summarize its structure.",
    icon: "document" as const,
  },
  {
    label: "Extract key pages",
    prompt: "Extract the most useful pages or sections from the current document.",
    icon: "bolt" as const,
  },
  {
    label: "Split the packet",
    prompt: "Split the current packet into useful sections I can review separately.",
    icon: "chart" as const,
  },
] as const;

const AGRICULTURE_STARTER_PROMPTS = [
  {
    label: "Identify crop",
    prompt: "Inspect the current crop photos, identify what crop is shown as specifically as the images support, and summarize the strongest visible evidence.",
    icon: "document" as const,
  },
  {
    label: "Estimate amount",
    prompt: "Estimate the visible amount, extent, or affected area shown in the current crop photos, label the estimate as rough, and explain what limits confidence.",
    icon: "analytics" as const,
  },
  {
    label: "Seasonal needs",
    prompt: "Based on the current crop photos and today's date, explain any likely issues, what the crop likely needs this season, and the most practical next steps.",
    icon: "bolt" as const,
  },
] as const;

const DOCUMENT_WORKSPACE_PANES = [
  { id: "browser", label: "Browser" },
  { id: "chat", label: "Chat" },
  { id: "outputs", label: "Preview" },
  { id: "account", label: "Account" },
] as const;

const AGRICULTURE_WORKSPACE_PANES = [
  { id: "farm", label: "Farm" },
  { id: "orders", label: "Orders" },
  { id: "chat", label: "Chat" },
  { id: "account", label: "Account" },
] as const;

const MOBILE_LAYOUT_BREAKPOINT = 980;

type WorkspacePaneId =
  | (typeof DOCUMENT_WORKSPACE_PANES)[number]["id"]
  | (typeof AGRICULTURE_WORKSPACE_PANES)[number]["id"];

function isWorkspacePaneId(value: string | null | undefined): value is WorkspacePaneId {
  return value === "browser" ||
    value === "chat" ||
    value === "outputs" ||
    value === "account" ||
    value === "farm" ||
    value === "orders";
}

function workspacePanesForApp(appId: WorkspaceAppId): readonly { id: WorkspacePaneId; label: string }[] {
  return appId === "agriculture"
    ? AGRICULTURE_WORKSPACE_PANES
    : DOCUMENT_WORKSPACE_PANES;
}

function defaultPaneIdForApp(appId: WorkspaceAppId): WorkspacePaneId {
  return appId === "agriculture" ? "chat" : "browser";
}

function normalizeWorkspacePaneId(
  value: string | null | undefined,
  appId: WorkspaceAppId,
): WorkspacePaneId {
  if (value === "overview") {
    return appId === "agriculture" ? "farm" : "browser";
  }
  const validPaneIds = new Set(workspacePanesForApp(appId).map((pane) => pane.id));
  return isWorkspacePaneId(value) && validPaneIds.has(value)
    ? value
    : defaultPaneIdForApp(appId);
}

function buildFileTypeLabel(file: WorkspaceUploadItemSummary): string {
  switch (file.kind) {
    case "csv":
    case "json":
      return "Data";
    case "pdf":
      return "Document";
    case "image":
      return "Image";
    default:
      return "File";
  }
}

function buildArtifactTypeLabel(artifact: WorkspaceCreatedItemSummary): string {
  switch (artifact.kind) {
    case "report.v1":
      return "Report";
    case "chart.v1":
      return "Chart";
    case "pdf_split.v1":
      return "PDF Split";
    case "farm.v1":
      return "Farm";
  }
}

function useIsMobileWorkspaceLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsMobile(window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  return isMobile;
}

function summarizeBrowserFile(file: WorkspaceUploadItemSummary): string {
  const missingSuffix = file.local_status === "missing" ? " · local payload unavailable" : "";
  if (file.kind === "csv" || file.kind === "json") {
    return "row_count" in file.preview
      ? `${file.preview.row_count} rows${missingSuffix}`
      : `Dataset${missingSuffix}`;
  }
  if (file.kind === "pdf") {
    return "page_count" in file.preview
      ? `${file.preview.page_count} pages${missingSuffix}`
      : `PDF${missingSuffix}`;
  }
  if (file.kind === "image") {
    return "width" in file.preview && "height" in file.preview
      ? `${file.preview.width} x ${file.preview.height}${missingSuffix}`
      : `Image${missingSuffix}`;
  }
  return `Upload${missingSuffix}`;
}

function summarizeBrowserArtifact(artifact: WorkspaceCreatedItemSummary): string {
  if (artifact.kind === "report.v1" && "slide_count" in artifact.summary) {
    return `${artifact.summary.slide_count} slide${artifact.summary.slide_count === 1 ? "" : "s"}`;
  }
  if (artifact.kind === "chart.v1" && "chart_plan_id" in artifact.summary) {
    return `${artifact.summary.chart_plan_id}`;
  }
  if (artifact.kind === "pdf_split.v1" && "entry_count" in artifact.summary) {
    return `${artifact.summary.entry_count} entries`;
  }
  if (artifact.kind === "farm.v1" && "crop_count" in artifact.summary) {
    return `${artifact.summary.crop_count} crops · ${artifact.summary.issue_count} issues · ${artifact.summary.order_count ?? 0} orders`;
  }
  return artifact.kind;
}

function sortArtifactsByUpdatedAt<T extends { updated_at: string }>(artifacts: T[]): T[] {
  return [...artifacts].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function buildAgricultureFocusTarget(
  entityType: string | undefined,
  itemId: string | undefined,
): FarmRecordFocusTarget {
  if (entityType === "farm_crop" && itemId) {
    return { kind: "crop", itemId };
  }
  if (entityType === "farm_issue" && itemId) {
    return { kind: "issue", itemId };
  }
  if (entityType === "farm_project" && itemId) {
    return { kind: "project", itemId };
  }
  if (entityType === "farm_current_work" && itemId) {
    return { kind: "current_work", itemId };
  }
  if (entityType === "farm_order" && itemId) {
    return { kind: "order", itemId };
  }
  return { kind: "record" };
}

function getStarterPromptsForApp(appId: WorkspaceAppId) {
  return appId === "documents"
    ? DOCUMENT_STARTER_PROMPTS
    : AGRICULTURE_STARTER_PROMPTS;
}

function normalizeDocumentImportHeaders(
  headers: DocumentImportHeader[],
): Record<string, string> {
  return Object.fromEntries(
    headers
      .map((header) => ({
        name: header.name.trim(),
        value: header.value.trim(),
      }))
      .filter((header) => header.name && header.value)
      .map((header) => [header.name, header.value]),
  );
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const encodedMatch = value.match(/filename\*\s*=\s*([^;]+)/i);
  if (encodedMatch?.[1]) {
    const encodedValue = encodedMatch[1]
      .trim()
      .replace(/^UTF-8''/i, "")
      .replace(/^["']|["']$/g, "");
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  }
  const simpleMatch = value.match(/filename\s*=\s*([^;]+)/i);
  return simpleMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

function buildImportedPdfFilename(
  url: string,
  contentDisposition: string | null,
  contentType: string | null,
): string {
  const fromDisposition = parseContentDispositionFilename(contentDisposition);
  const fromUrl = (() => {
    try {
      const parsed = new URL(url);
      return decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    } catch {
      return "";
    }
  })();
  const candidate = (fromDisposition || fromUrl || `document_${crypto.randomUUID()}`).trim();
  const withoutQuery = candidate.split(/[?#]/, 1)[0] || `document_${crypto.randomUUID()}`;
  if (withoutQuery.toLowerCase().endsWith(".pdf")) {
    return withoutQuery;
  }
  if ((contentType ?? "").toLowerCase().includes("application/pdf")) {
    return `${withoutQuery}.pdf`;
  }
  return withoutQuery;
}

function isImportedPdf(filename: string, contentType: string | null): boolean {
  const normalizedContentType = (contentType ?? "").toLowerCase();
  return filename.toLowerCase().endsWith(".pdf") || normalizedContentType.includes("application/pdf");
}

function buildDocumentImportErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TypeError") {
      return "Browser URL import was blocked by CORS or the remote server rejected the request headers. Download the PDF locally and upload it instead.";
    }
    return error.message;
  }
  return "Browser URL import failed.";
}

export function WorkspaceBrowserPanel({
  activeWorkspaceId,
  artifacts,
  workspaces,
  onClear,
  onCreateWorkspace,
  onSelectWorkspace,
  onSelectItem,
  emptyUploadsMessage,
  files,
  selectedItem,
  showFiles = true,
}: {
  activeWorkspaceId: string | null;
  artifacts: WorkspaceCreatedItemSummary[];
  workspaces: WorkspaceListItem[];
  onClear: () => void;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectItem: (selection: PreviewSelection) => void;
  emptyUploadsMessage?: string;
  files: WorkspaceUploadItemSummary[];
  selectedItem: PreviewSelection;
  showFiles?: boolean;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const filteredFiles = useMemo(
    () =>
      (showFiles ? files : []).filter((file) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          file.name,
          file.kind,
          file.origin,
          buildFileTypeLabel(file),
          summarizeBrowserFile(file),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [files, normalizedQuery, showFiles],
  );
  const filteredArtifacts = useMemo(
    () =>
      artifacts.filter((artifact) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          artifact.title,
          artifact.kind,
          artifact.latest_op,
          buildArtifactTypeLabel(artifact),
          summarizeBrowserArtifact(artifact),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [artifacts, normalizedQuery],
  );
  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? "";
  const fileCount = showFiles ? files.length : 0;
  const artifactCount = artifacts.length;
  const filteredItems = useMemo(
    () =>
      [
        ...filteredFiles.map((file) => ({
          itemType: "file" as const,
          id: file.id,
          title: file.name,
          label: buildFileTypeLabel(file),
          summary: summarizeBrowserFile(file),
          updatedAt: file.updated_at,
        })),
        ...filteredArtifacts.map((artifact) => ({
          itemType: "artifact" as const,
          id: artifact.id,
          title: artifact.title,
          label: buildArtifactTypeLabel(artifact),
          summary: summarizeBrowserArtifact(artifact),
          updatedAt: artifact.updated_at,
        })),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [filteredArtifacts, filteredFiles],
  );

  return (
    <OverviewPanel data-testid="workspace-browser">
      <WorkspaceToolbar>
        <OverviewSelect
          aria-label="Select workspace"
          data-testid="workspace-context-selector"
          onChange={(event) => {
            const nextWorkspaceId = event.target.value.trim();
            if (!nextWorkspaceId) {
              return;
            }
            onSelectWorkspace(nextWorkspaceId);
          }}
          value={selectedWorkspaceId}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </OverviewSelect>
        <OverviewActionRow>
          <OverviewActionButton onClick={onCreateWorkspace} type="button">
            New workspace
          </OverviewActionButton>
          <OverviewActionButton onClick={onClear} type="button">
            Clear
          </OverviewActionButton>
        </OverviewActionRow>
      </WorkspaceToolbar>

      <InventoryToolbar>
        <InventorySummary data-testid="workspace-inventory-summary">
          <span>{showFiles ? "Stuff" : "Artifacts"}</span>
          <InventoryTabCount>{fileCount + artifactCount}</InventoryTabCount>
        </InventorySummary>
      </InventoryToolbar>

      <FilterPanel>
        <FilterInput
          aria-label="Filter workspace items"
          data-testid="workspace-filter-input"
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter workspace items"
          type="search"
          value={filterQuery}
        />
      </FilterPanel>

      <TreePanel data-testid="workspace-resource-tree">
        {filteredItems.length ? (
          filteredItems.map((item) =>
            item.itemType === "file" ? (
              <TreeLeafButton
                key={item.id}
                $active={selectedItem?.kind === "file" && selectedItem.id === item.id}
                data-testid={`workspace-resource-file-${item.id}`}
                onClick={() => onSelectItem({ kind: "file", id: item.id })}
                type="button"
              >
                <TreeLeafMeta>{item.label}</TreeLeafMeta>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </TreeLeafButton>
            ) : (
              <TreeLeafButton
                key={item.id}
                $active={selectedItem?.kind === "artifact" && selectedItem.id === item.id}
                data-testid={`workspace-resource-artifact-${item.id}`}
                onClick={() => onSelectItem({ kind: "artifact", id: item.id })}
                type="button"
              >
                <TreeLeafMeta>{item.label}</TreeLeafMeta>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </TreeLeafButton>
            ),
          )
        ) : (
          <EmptyTreeState>
            {normalizedQuery
              ? "No workspace items match the current filter."
              : (emptyUploadsMessage ?? "Nothing in this workspace yet.")}
          </EmptyTreeState>
        )}
      </TreePanel>
    </OverviewPanel>
  );
}

export function DocumentBrowserPanel({
  activeThreadId,
  activeWorkspaceId,
  documentFiles,
  onCreateWorkspace,
  onDeleteFile,
  onImportUrl,
  onOpenFile,
  onRefresh,
  onSelectWorkspace,
  onUploadFiles,
  workspaces,
}: {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  documentFiles: DocumentFileSummary[];
  onCreateWorkspace: () => void;
  onDeleteFile: (fileId: string) => Promise<void>;
  onImportUrl: (url: string, headers: DocumentImportHeader[]) => Promise<void>;
  onOpenFile: (file: DocumentFileSummary, mode: "open" | "download") => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onUploadFiles: (files: FileList | Iterable<File> | null | undefined) => Promise<void>;
  workspaces: WorkspaceListItem[];
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [headers, setHeaders] = useState<DocumentImportHeader[]>([{ name: "", value: "" }]);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? "";
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const filteredFiles = useMemo(
    () =>
      documentFiles.filter((file) => {
        if (!normalizedQuery) {
          return true;
        }
        const previewSummary =
          file.preview.kind === "pdf"
            ? `${file.preview.page_count} pages`
            : file.preview.kind === "dataset"
              ? `${file.preview.row_count} rows`
              : file.kind;
        return [file.name, file.kind, file.source_kind, previewSummary]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [documentFiles, normalizedQuery],
  );

  return (
    <OverviewPanel data-testid="document-browser">
      <input
        ref={uploadInputRef}
        accept=".pdf,.csv,.json"
        hidden
        multiple
        onChange={(event) => {
          const nextFiles = event.target.files;
          event.target.value = "";
          void onUploadFiles(nextFiles);
        }}
        type="file"
      />
      <WorkspaceToolbar>
        <OverviewSelect
          aria-label="Select workspace"
          data-testid="document-workspace-selector"
          onChange={(event) => {
            const nextWorkspaceId = event.target.value.trim();
            if (nextWorkspaceId) {
              onSelectWorkspace(nextWorkspaceId);
            }
          }}
          value={selectedWorkspaceId}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </OverviewSelect>
        <OverviewActionRow>
          <OverviewActionButton onClick={onCreateWorkspace} type="button">
            New workspace
          </OverviewActionButton>
          <UploadActionButton
            onClick={() => uploadInputRef.current?.click()}
            type="button"
          >
            Attach for agent access
          </UploadActionButton>
          <OverviewActionButton onClick={() => void onRefresh()} type="button">
            Refresh
          </OverviewActionButton>
        </OverviewActionRow>
      </WorkspaceToolbar>

      <FilterPanel>
        <FilterInput
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter document files"
          type="search"
          value={filterQuery}
        />
      </FilterPanel>

      <DocumentImportPanel>
        <DocumentImportTitle>Import PDF For Agent Access</DocumentImportTitle>
        <DocumentImportInput
          onChange={(event) => setImportUrl(event.target.value)}
          placeholder="https://example.com/private.pdf"
          type="url"
          value={importUrl}
        />
        {headers.map((header, index) => (
          <DocumentHeaderRow key={`header-${index}`}>
            <DocumentImportInput
              onChange={(event) => {
                const value = event.target.value;
                setHeaders((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: value } : item,
                  ),
                );
              }}
              placeholder="Header name"
              type="text"
              value={header.name}
            />
            <DocumentImportInput
              onChange={(event) => {
                const value = event.target.value;
                setHeaders((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value } : item,
                  ),
                );
              }}
              placeholder="Header value"
              type="password"
              value={header.value}
            />
            {headers.length > 1 ? (
              <InlineTextButton
                onClick={() =>
                  setHeaders((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                type="button"
              >
                Remove
              </InlineTextButton>
            ) : null}
          </DocumentHeaderRow>
        ))}
        <OverviewActionRow>
          <OverviewActionButton
            onClick={() =>
              setHeaders((current) => [...current, { name: "", value: "" }])
            }
            type="button"
          >
            Add header
          </OverviewActionButton>
          <UploadActionButton
            onClick={() => {
              const filteredHeaders = headers.filter(
                (header) => header.name.trim() && header.value.trim(),
              );
              void onImportUrl(importUrl.trim(), filteredHeaders)
                .then(() => {
                  setImportUrl("");
                  setHeaders([{ name: "", value: "" }]);
                })
                .catch(() => undefined);
            }}
            type="button"
          >
            Import PDF
          </UploadActionButton>
        </OverviewActionRow>
        <MetaText>
          Headers stay in this form and are sent directly from this browser. If the site blocks CORS or custom headers, import will fail here.
        </MetaText>
      </DocumentImportPanel>

      <TreePanel>
        {!activeThreadId ? (
          <EmptyTreeState>
            Use normal chat attachments for transient context, or attach/import a PDF here for agent access.
          </EmptyTreeState>
        ) : filteredFiles.length ? (
          filteredFiles.map((file) => (
            <DocumentFileCard key={file.id}>
              <DocumentFileMeta>
                <strong>{file.name}</strong>
                <span>
                  {file.kind.toUpperCase()} · {file.source_kind}
                  {file.preview.kind === "pdf" ? ` · ${file.preview.page_count} pages` : ""}
                  {file.preview.kind === "dataset" ? ` · ${file.preview.row_count} rows` : ""}
                </span>
              </DocumentFileMeta>
              <DocumentFileActions>
                <InlineTextButton onClick={() => void onOpenFile(file, "open")} type="button">
                  Open
                </InlineTextButton>
                <InlineTextButton
                  onClick={() => void onOpenFile(file, "download")}
                  type="button"
                >
                  Download
                </InlineTextButton>
                <InlineTextButton onClick={() => void onDeleteFile(file.id)} type="button">
                  Delete
                </InlineTextButton>
              </DocumentFileActions>
            </DocumentFileCard>
          ))
        ) : (
          <EmptyTreeState>No document files are stored for this thread yet.</EmptyTreeState>
        )}
      </TreePanel>
    </OverviewPanel>
  );
}

function AccountPane() {
  return (
    <AccountPaneShell data-testid="workspace-account-pane">
      <AccountPaneTitle>Account</AccountPaneTitle>
      <AccountPaneMeta>Identity and credit status stay here on mobile.</AccountPaneMeta>
      <AuthPanel mode="account" compact />
    </AccountPaneShell>
  );
}

type ComposerDraft = NonNullable<ComponentProps<typeof ChatKitPane>["composerDraft"]>;

type WorkspaceAppPageProps = {
  appId: WorkspaceAppId;
  agentDefinition: AgentDefinition;
  rootAgentId: "agriculture-agent" | "document-agent";
};

export function WorkspaceAppPage({
  appId,
  agentDefinition,
  rootAgentId,
}: WorkspaceAppPageProps) {
  const { user } = useAppState();
  const isMobileLayout = useIsMobileWorkspaceLayout();
  const {
    hydrated,
    currentAppId,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceName,
    selectedFileId,
    selectedArtifactId,
    currentReportArtifactId,
    listFiles,
    getFile,
    resolveLocalFile,
    registerFile,
    listArtifacts,
    getArtifact,
    listArtifactRevisions,
    createArtifact,
    deleteArtifact,
    applyArtifactOperation,
    updateWorkspace,
    selectWorkspace,
    createWorkspace,
    removeWorkspaceFile,
    consumePendingComposerLaunch,
  } = useAgentShell();
  const [selectedPreviewItem, setSelectedPreviewItem] = useState<PreviewSelection>(null);
  const [agricultureFocusTarget, setAgricultureFocusTarget] =
    useState<FarmRecordFocusTarget | null>(null);
  const [activeAgricultureDesktopSectionId, setActiveAgricultureDesktopSectionId] = useState<
    "farm" | "orders"
  >("farm");
  const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(null);
  const [activePaneId, setActivePaneId] = useState<WorkspacePaneId>(
    () => defaultPaneIdForApp(appId),
  );
  const [localWorkspaceFiles, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [documentFiles, setDocumentFiles] = useState<DocumentFileSummary[]>([]);
  const [hasMountedMobileChatPane, setHasMountedMobileChatPane] = useState(
    () => !isMobileLayout || activePaneId === "chat",
  );
  const workspaceFiles = useMemo(() => listFiles(), [listFiles]);
  const workspaceArtifacts = useMemo(() => listArtifacts(), [listArtifacts]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(
        workspaceFiles
          .filter((file) => file.local_status === "available")
          .map((file) => resolveLocalFile(file.id)),
      );
      if (!cancelled) {
        setLocalAttachments(
          resolved.filter((file): file is LocalAttachment => file !== null),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveLocalFile, workspaceFiles]);

  const refreshDocumentFileList = useCallback(async () => {
    if (appId !== "documents" || !activeWorkspace?.active_chat_id) {
      setDocumentFiles([]);
      return;
    }
    try {
      const response = await listDocumentFiles(activeWorkspace.active_chat_id);
      setDocumentFiles(response.files);
    } catch {
      setDocumentFiles([]);
    }
  }, [activeWorkspace?.active_chat_id, appId]);

  useEffect(() => {
    void refreshDocumentFileList();
  }, [refreshDocumentFileList]);

  const runtimeContext = useMemo<AgentRuntimeContext>(
    () => ({
      workspaceId: activeWorkspace?.workspace_id ?? "workspace-pending",
      workspaceName: activeWorkspace?.workspace_name ?? "Workspace",
      activeThreadId: activeWorkspace?.active_chat_id ?? null,
      activeAgentId: rootAgentId,
      selectedFileId,
      selectedArtifactId,
      currentReportArtifactId,
      listFiles,
      getFile,
      resolveLocalFile,
      registerFile,
      removeFile: removeWorkspaceFile,
      listArtifacts,
      getArtifact,
      listArtifactRevisions,
      createArtifact,
      applyArtifactOperation,
      updateWorkspace,
    }),
    [
      activeWorkspace?.active_chat_id,
      activeWorkspace?.workspace_id,
      activeWorkspace?.workspace_name,
      applyArtifactOperation,
      createArtifact,
      currentReportArtifactId,
      getArtifact,
      getFile,
      listArtifactRevisions,
      listArtifacts,
      listFiles,
      registerFile,
      removeWorkspaceFile,
      resolveLocalFile,
      selectedArtifactId,
      selectedFileId,
      rootAgentId,
      updateWorkspace,
    ],
  );

  const agentBundle = useMemo(
    () => buildAgentBundleForRoot(rootAgentId, runtimeContext),
    [rootAgentId, runtimeContext],
  );
  const clientTools = useMemo(
    () => bindClientToolsForAgentBundle(agentBundle, runtimeContext),
    [agentBundle, runtimeContext],
  );

  useEffect(() => {
    setActivePaneId((current) => normalizeWorkspacePaneId(current, appId));
  }, [appId]);

  useEffect(() => {
    if (!isMobileLayout || activePaneId === "chat") {
      setHasMountedMobileChatPane(true);
    }
  }, [activePaneId, isMobileLayout]);

  useEffect(() => {
    if (!activeWorkspaceId || currentAppId !== appId) {
      return;
    }
    const pendingLaunch = consumePendingComposerLaunch(appId, activeWorkspaceId);
    if (!pendingLaunch) {
      return;
    }
    setComposerDraft({
      id: `workspace-draft:${appId}:${activeWorkspaceId}`,
      prompt: pendingLaunch.prompt,
      model: pendingLaunch.model ?? undefined,
    });
  }, [activeWorkspaceId, appId, consumePendingComposerLaunch, currentAppId]);

  useEffect(() => {
    if (appId !== "documents") {
      setSelectedPreviewItem(null);
      return;
    }
    setSelectedPreviewItem((current) => {
      if (
        current?.kind === "artifact" &&
        workspaceArtifacts.some((artifact) => artifact.id === current.id)
      ) {
        return current;
      }
      if (
        current?.kind === "file" &&
        workspaceFiles.some((file) => file.id === current.id)
      ) {
        return current;
      }
      const nextArtifactId =
        selectedArtifactId ??
        currentReportArtifactId ??
        workspaceArtifacts[0]?.id ??
        null;
      if (nextArtifactId) {
        return { kind: "artifact", id: nextArtifactId };
      }
      const nextFileId = selectedFileId ?? workspaceFiles[0]?.id ?? null;
      return nextFileId ? { kind: "file", id: nextFileId } : null;
    });
  }, [
    appId,
    currentReportArtifactId,
    selectedArtifactId,
    selectedFileId,
    workspaceArtifacts,
    workspaceFiles,
  ]);

  useEffect(() => {
    if (appId === "agriculture") {
      setAgricultureFocusTarget(null);
    }
  }, [activeWorkspaceId, appId]);

  const handlePaneChange = useCallback(
    (paneId: WorkspacePaneId) => {
      setActivePaneId(paneId);
    },
    [],
  );

  const handleRunStart = useCallback(() => {
    handlePaneChange("chat");
  }, [handlePaneChange]);

  const setActiveAgricultureSection = useCallback(
    (sectionId: "farm" | "orders") => {
      if (isMobileLayout) {
        handlePaneChange(sectionId);
        return;
      }
      setActiveAgricultureDesktopSectionId(sectionId);
    },
    [handlePaneChange, isMobileLayout],
  );

  const handleSelectWorkspace = useCallback(
    async (workspaceId: string) => {
      await selectWorkspace(workspaceId);
    },
    [selectWorkspace],
  );

  const handleActiveChatChange = useCallback(
    async (nextChatId: string | null) => {
      if ((activeWorkspace?.active_chat_id ?? null) === nextChatId) {
        return;
      }
      await updateWorkspace({
        active_chat_id: nextChatId,
      });
    },
    [activeWorkspace?.active_chat_id, updateWorkspace],
  );

  const handleDocumentPreviewSelection = useCallback(
    (selection: PreviewSelection) => {
      setSelectedPreviewItem(selection);
      if (selection?.kind === "artifact") {
        const artifact = workspaceArtifacts.find((item) => item.id === selection.id) ?? null;
        void updateWorkspace({
          selected_item_id: selection.id,
          current_report_item_id:
            artifact?.kind === "report.v1" ? selection.id : currentReportArtifactId,
        });
      } else if (selection?.kind === "file") {
        void updateWorkspace({
          selected_item_id: selection.id,
        });
      }
      handlePaneChange("outputs");
    },
    [currentReportArtifactId, handlePaneChange, updateWorkspace, workspaceArtifacts],
  );

  const agricultureEntitiesConfig = useMemo(() => {
    if (appId !== "agriculture") {
      return undefined;
    }

    return {
      enabled: true,
      showComposerMenu: true,
      onTagSearch: async (query: string) => {
        if (!activeWorkspace?.workspace_id || !activeWorkspace.active_chat_id) {
          return [];
        }
        try {
          const response = await searchAgricultureEntities({
            appId: activeWorkspace.app_id,
            workspaceId: activeWorkspace.workspace_id,
            threadId: activeWorkspace.active_chat_id,
            query,
          });
          return response.entities.map((entity) => ({
            id: entity.id,
            title: entity.title,
            ...(entity.icon ? { icon: entity.icon } : {}),
            ...(entity.group ? { group: entity.group } : {}),
            ...(typeof entity.interactive === "boolean"
              ? { interactive: entity.interactive }
              : {}),
            data: entity.data,
          }));
        } catch {
          return [];
        }
      },
      onClick: (entity: Entity) => {
        const entityData = entity.data;
        if (!entityData) {
          return;
        }
        const entityType = entityData.entity_type;
        if (entityType === "thread_image") {
          return;
        }
        const artifactId = entityData.artifact_id;
        if (artifactId && workspaceArtifacts.some((artifact) => artifact.id === artifactId)) {
          const artifact = workspaceArtifacts.find((item) => item.id === artifactId) ?? null;
          setAgricultureFocusTarget(
            buildAgricultureFocusTarget(entityType, entityData.item_id),
          );
          void updateWorkspace({
            selected_item_id: artifactId,
            current_report_item_id:
              artifact?.kind === "report.v1" ? artifactId : currentReportArtifactId,
          });
          setActiveAgricultureSection(entityType === "farm_order" ? "orders" : "farm");
        }
      },
      onRequestPreview: async (entity: Entity) =>
        buildAgricultureEntityPreview(entity),
    } as const;
  }, [
    activeWorkspace?.active_chat_id,
    activeWorkspace?.app_id,
    activeWorkspace?.workspace_id,
    appId,
    currentReportArtifactId,
    setActiveAgricultureSection,
    updateWorkspace,
    workspaceArtifacts,
  ]);

  const handleDocumentUpload = useCallback(
    async (files: FileList | Iterable<File> | null | undefined) => {
      if (!activeWorkspace?.workspace_id) {
        return;
      }
      const nextFiles =
        typeof FileList !== "undefined" && files instanceof FileList
          ? Array.from(files)
          : Array.from(files ?? []);
      if (!nextFiles.length) {
        return;
      }
      let nextThreadId = activeWorkspace.active_chat_id ?? null;
      for (const file of nextFiles) {
        const previewJson = await buildStoredFilePreviewFromFile(file);
        const response = await uploadStoredFile({
          file,
          workspaceId: activeWorkspace.workspace_id,
          appId: activeWorkspace.app_id,
          scope: "document_thread_file",
          threadId: nextThreadId,
          createAttachment: false,
          sourceKind: "upload",
          previewJson,
        });
        nextThreadId = response.thread_id ?? nextThreadId;
      }
      if (nextThreadId !== (activeWorkspace.active_chat_id ?? null)) {
        await updateWorkspace({
          active_chat_id: nextThreadId,
        });
      }
      await refreshDocumentFileList();
    },
    [
      activeWorkspace?.active_chat_id,
      activeWorkspace?.app_id,
      activeWorkspace?.workspace_id,
      refreshDocumentFileList,
      updateWorkspace,
    ],
  );

  const handleDocumentImport = useCallback(
    async (url: string, headers: DocumentImportHeader[]) => {
      if (!activeWorkspace?.workspace_id || !url.trim()) {
        return;
      }
      try {
        const fetchResponse = await fetch(url.trim(), {
          headers: normalizeDocumentImportHeaders(headers),
        });
        if (!fetchResponse.ok) {
          throw new Error(
            `The remote server returned ${fetchResponse.status} ${fetchResponse.statusText || "for this URL import"}.`,
          );
        }

        const contentType = fetchResponse.headers.get("content-type");
        const fileName = buildImportedPdfFilename(
          url.trim(),
          fetchResponse.headers.get("content-disposition"),
          contentType,
        );
        if (!isImportedPdf(fileName, contentType)) {
          throw new Error("Browser URL import only supports PDF files.");
        }

        const blob = await fetchResponse.blob();
        const file = new File([blob], fileName, {
          type: contentType || "application/pdf",
        });
        const previewJson = await buildStoredFilePreviewFromFile(file);
        const response = await uploadStoredFile({
          file,
          workspaceId: activeWorkspace.workspace_id,
          appId: activeWorkspace.app_id,
          scope: "document_thread_file",
          threadId: activeWorkspace.active_chat_id ?? null,
          createAttachment: false,
          sourceKind: "url_import",
          previewJson,
        });
        if (response.thread_id && response.thread_id !== (activeWorkspace.active_chat_id ?? null)) {
          await updateWorkspace({
            active_chat_id: response.thread_id,
          });
        }
        await refreshDocumentFileList();
      } catch (error) {
        publishToast({
          title: "Import failed",
          message: buildDocumentImportErrorMessage(error),
          tone: "error",
        });
        throw error;
      }
    },
    [
      activeWorkspace?.active_chat_id,
      activeWorkspace?.app_id,
      activeWorkspace?.workspace_id,
      refreshDocumentFileList,
      updateWorkspace,
    ],
  );

  const handleDocumentDelete = useCallback(
    async (fileId: string) => {
      if (!activeWorkspace?.active_chat_id) {
        return;
      }
      await deleteDocumentFile(activeWorkspace.active_chat_id, fileId);
      await refreshDocumentFileList();
    },
    [activeWorkspace?.active_chat_id, refreshDocumentFileList],
  );

  const resolveAgricultureArtifactFile = useCallback(
    async (fileId: string) => {
      if (
        appId !== "agriculture" ||
        !activeWorkspace?.workspace_id ||
        !activeWorkspace.active_chat_id
      ) {
        return null;
      }

      const response = await searchAgricultureEntities({
        appId: activeWorkspace.app_id,
        workspaceId: activeWorkspace.workspace_id,
        threadId: activeWorkspace.active_chat_id,
        query: "",
      });
      const imageEntity = response.entities.find(
        (entity) =>
          entity.data.entity_type === "thread_image" && entity.data.file_id === fileId,
      );
      if (!imageEntity) {
        return null;
      }

      const blob = await fetchStoredFileBlob(fileId);
      const builtFile = await buildWorkspaceFile(
        new File([blob], imageEntity.title, {
          type: imageEntity.data.mime_type || blob.type || "image/png",
        }),
        { id: fileId },
      );
      return builtFile.kind === "image" ? builtFile : null;
    },
    [
      activeWorkspace?.active_chat_id,
      activeWorkspace?.app_id,
      activeWorkspace?.workspace_id,
      appId,
    ],
  );

  const handleDocumentFileOpen = useCallback(
    async (file: DocumentFileSummary, mode: "open" | "download") => {
      const blob = await fetchStoredFileBlob(file.id);
      const objectUrl = URL.createObjectURL(blob);
      if (mode === "download") {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = file.name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return;
      }
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    },
    [],
  );

  const latestFarmArtifact = useMemo(
    () =>
      sortArtifactsByUpdatedAt(
        workspaceArtifacts.filter((artifact) => artifact.kind === "farm.v1"),
      )[0] ?? null,
    [workspaceArtifacts],
  );
  const selectedAgricultureArtifactId = useMemo(() => {
    const availableIds = new Set(workspaceArtifacts.map((artifact) => artifact.id));
    if (selectedArtifactId && availableIds.has(selectedArtifactId)) {
      return selectedArtifactId;
    }
    if (currentReportArtifactId && availableIds.has(currentReportArtifactId)) {
      return currentReportArtifactId;
    }
    return null;
  }, [currentReportArtifactId, selectedArtifactId, workspaceArtifacts]);

  if (!user) {
    return null;
  }

  const documentBrowserPane = (
    <DocumentBrowserPanel
      activeThreadId={activeWorkspace?.active_chat_id ?? null}
      activeWorkspaceId={activeWorkspaceId}
      documentFiles={documentFiles}
      onCreateWorkspace={() => {
        void createWorkspace();
      }}
      onDeleteFile={handleDocumentDelete}
      onImportUrl={handleDocumentImport}
      onOpenFile={handleDocumentFileOpen}
      onRefresh={refreshDocumentFileList}
      onSelectWorkspace={handleSelectWorkspace}
      onUploadFiles={handleDocumentUpload}
      workspaces={workspaces}
    />
  );

  const renderAgriculturePane = (sectionId: "farm" | "orders", showSectionTabs: boolean) => (
    <AgricultureFarmPane
      activeSectionId={sectionId}
      activeWorkspaceId={activeWorkspaceId}
      applyArtifactOperation={applyArtifactOperation}
      deleteArtifact={deleteArtifact}
      farmArtifactSummary={latestFarmArtifact}
      focusTarget={agricultureFocusTarget}
      getArtifact={getArtifact}
      onCreateWorkspace={() => {
        void createWorkspace();
      }}
      onSelectSection={setActiveAgricultureSection}
      onSelectWorkspace={handleSelectWorkspace}
      selectedArtifactId={selectedAgricultureArtifactId}
      showSectionTabs={showSectionTabs}
      workspaces={workspaces}
    />
  );

  const agricultureSectionId = isMobileLayout
    ? activePaneId === "orders"
      ? "orders"
      : "farm"
    : activeAgricultureDesktopSectionId;
  const agricultureFarmPane = renderAgriculturePane(agricultureSectionId, !isMobileLayout);

  const documentOutputsPane = (
    <AgentPreviewPane
      artifacts={workspaceArtifacts}
      files={workspaceFiles}
      resolveLocalFile={resolveLocalFile}
      resolveSupplementalLocalFile={resolveAgricultureArtifactFile}
      getArtifact={getArtifact}
      selectedItem={selectedPreviewItem}
    />
  );

  const chatPane = (
    <ChatKitPane
      agentBundle={agentBundle}
      enabled={hydrated}
      files={appId === "agriculture" ? [] : localWorkspaceFiles}
      workspaceState={activeWorkspace ?? undefined}
      investigationBrief=""
      clientTools={clientTools}
      onEffects={() => undefined}
      greeting={agentDefinition.chatkitLead}
      prompts={getStarterPromptsForApp(appId)}
      composerPlaceholder={agentDefinition.chatkitPlaceholder}
      colorScheme="light"
      activeChatId={activeWorkspace?.active_chat_id ?? null}
      onActiveChatChange={handleActiveChatChange}
      showChatKitHeader
      showComposerTools={false}
      surfaceMinHeight={isMobileLayout ? 420 : 560}
      onRunStart={handleRunStart}
      onRunEnd={appId === "documents" ? () => void refreshDocumentFileList() : undefined}
      attachmentConfig={agentDefinition.attachmentConfig}
      entitiesConfig={agricultureEntitiesConfig}
      composerDraft={composerDraft}
      onComposerDraftApplied={(draftId) => {
        setComposerDraft((current) => (current?.id === draftId ? null : current));
      }}
    />
  );

  const accountPane = <AccountPane />;

  if (appId === "agriculture") {
    return (
      <WorkspaceAgentPage>
        {isMobileLayout ? (
          <>
            <MobilePaneTabs data-testid="workspace-mobile-tabs">
              {workspacePanesForApp(appId).map((pane) => (
                <MobilePaneTabButton
                  key={pane.id}
                  $active={pane.id === activePaneId}
                  aria-pressed={pane.id === activePaneId}
                  data-testid={`workspace-mobile-tab-${pane.id}`}
                  onClick={() => handlePaneChange(pane.id)}
                  type="button"
                >
                  {pane.label}
                </MobilePaneTabButton>
              ))}
            </MobilePaneTabs>

            <MobilePaneStack>
              <MobilePane data-testid="workspace-pane-farm" hidden={activePaneId !== "farm"}>
                {renderAgriculturePane("farm", false)}
              </MobilePane>
              <MobilePane data-testid="workspace-pane-orders" hidden={activePaneId !== "orders"}>
                {renderAgriculturePane("orders", false)}
              </MobilePane>
              <MobilePane data-testid="workspace-pane-chat" hidden={activePaneId !== "chat"}>
                {activePaneId === "chat" || hasMountedMobileChatPane ? chatPane : null}
              </MobilePane>
              <MobilePane data-testid="workspace-pane-account" hidden={activePaneId !== "account"}>
                {accountPane}
              </MobilePane>
            </MobilePaneStack>
          </>
        ) : (
          <DesktopAgricultureLayout>
            <DesktopFarmColumn>{agricultureFarmPane}</DesktopFarmColumn>
            <DesktopChatColumn>{chatPane}</DesktopChatColumn>
          </DesktopAgricultureLayout>
        )}
      </WorkspaceAgentPage>
    );
  }

  return (
    <WorkspaceAgentPage>
      {isMobileLayout ? (
        <>
          <MobilePaneTabs data-testid="workspace-mobile-tabs">
            {workspacePanesForApp(appId).map((pane) => (
              <MobilePaneTabButton
                key={pane.id}
                $active={pane.id === activePaneId}
                aria-pressed={pane.id === activePaneId}
                data-testid={`workspace-mobile-tab-${pane.id}`}
                onClick={() => handlePaneChange(pane.id)}
                type="button"
              >
                {pane.label}
              </MobilePaneTabButton>
            ))}
          </MobilePaneTabs>

          <MobilePaneStack>
            <MobilePane data-testid="workspace-pane-browser" hidden={activePaneId !== "browser"}>
              {documentBrowserPane}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-chat" hidden={activePaneId !== "chat"}>
              {activePaneId === "chat" || hasMountedMobileChatPane ? chatPane : null}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-outputs" hidden={activePaneId !== "outputs"}>
              {documentOutputsPane}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-account" hidden={activePaneId !== "account"}>
              {accountPane}
            </MobilePane>
          </MobilePaneStack>
        </>
      ) : (
        <DesktopShellLayout>
          <DesktopOverviewColumn>{documentBrowserPane}</DesktopOverviewColumn>

          <DesktopMainStage>
            <DesktopOutputsColumn>{documentOutputsPane}</DesktopOutputsColumn>
            <DesktopChatColumn>{chatPane}</DesktopChatColumn>
          </DesktopMainStage>
        </DesktopShellLayout>
      )}
    </WorkspaceAgentPage>
  );
}

export function AgricultureWorkspacePage() {
  return (
    <WorkspaceAppPage
      appId="agriculture"
      agentDefinition={agricultureAgentDefinition}
      rootAgentId="agriculture-agent"
    />
  );
}

export function DocumentWorkspacePage() {
  return (
    <WorkspaceAppPage
      appId="documents"
      agentDefinition={documentAgentDefinition}
      rootAgentId="document-agent"
    />
  );
}

const WorkspaceAgentPage = styled(AgentPage)`
  @media (min-width: 981px) {
    grid-template-rows: minmax(0, 1fr);
  }
`;

const DesktopShellLayout = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(248px, 292px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 0.72rem;
  align-items: stretch;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    height: auto;
  }
`;

const DesktopAgricultureLayout = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(280px, 0.96fr) minmax(320px, 0.92fr);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "farm chat";
  gap: 0.72rem;
  align-items: stretch;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    grid-template-areas:
      "farm"
      "chat";
    height: auto;
  }
`;

const DesktopOverviewColumn = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  position: sticky;
  top: 0;

  @media (max-width: 1320px) {
    position: static;
  }
`;

const DesktopFarmColumn = styled.div`
  grid-area: farm;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const DesktopMainStage = styled.section`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(320px, 0.72fr);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "outputs chat";
  gap: 0.72rem;
  align-items: stretch;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    grid-template-areas:
      "chat"
      "outputs";
    height: auto;
  }
`;

const DesktopOutputsColumn = styled.div`
  grid-area: outputs;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const DesktopChatColumn = styled.div`
  grid-area: chat;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const OverviewPanel = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 0.62rem;
  padding: 0.82rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(248, 242, 235, 0.88)),
    rgba(255, 255, 255, 0.8);
  box-shadow: 0 18px 44px rgba(32, 26, 20, 0.08);
`;

const WorkspaceToolbar = styled.div`
  display: grid;
  gap: 0.55rem;
`;

const OverviewSelect = styled.select`
  width: 100%;
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink);
  padding: 0.58rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
`;

const OverviewActionRow = styled.div`
  display: flex;
  gap: 0.38rem;
  flex-wrap: wrap;
`;

const InventoryToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  flex-wrap: wrap;
`;

const InventorySummary = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.72rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.68);
  color: var(--ink);
  font-size: 0.74rem;
  font-weight: 700;
`;

const UploadActionButton = styled.button`
  border: 1px solid color-mix(in srgb, var(--accent) 24%, rgba(31, 41, 55, 0.08));
  border-radius: 999px;
  padding: 0.46rem 0.82rem;
  background: color-mix(in srgb, var(--accent) 10%, white 90%);
  color: var(--accent-deep);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 800;
  cursor: pointer;
`;

const InventoryTabs = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.68);
`;

const InventoryTabButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0.38rem 0.7rem;
  background: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--accent) 16%, white 84%)" : "transparent"};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--muted)")};
  font: inherit;
  font-size: 0.73rem;
  font-weight: 700;
  cursor: pointer;
`;

const InventoryTabCount = styled.span`
  margin-left: 0.34rem;
  font-size: 0.68rem;
  opacity: 0.78;
`;

const OverviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: 999px;
  padding: 0.44rem 0.74rem;
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
`;

const FilterPanel = styled.div`
  min-width: 0;
`;

const FilterInput = styled.input`
  width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.84);
  color: var(--ink);
  padding: 0.62rem 0.72rem;
  font: inherit;
  font-size: 0.78rem;

  &::placeholder {
    color: color-mix(in srgb, var(--muted) 76%, white 24%);
  }
`;

const TreePanel = styled.div`
  min-height: 0;
  height: 100%;
  display: grid;
  align-content: start;
  gap: 0.62rem;
  overflow: auto;
  padding-right: 0.12rem;
`;

const TreeLeafButton = styled.button<{ $active: boolean }>`
  display: grid;
  gap: 0.14rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.58rem;
  border-radius: 12px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "color-mix(in srgb, var(--accent) 36%, rgba(31, 41, 55, 0.08))"
        : "rgba(31, 41, 55, 0.08)"};
  background: ${({ $active }) =>
    $active
      ? "rgba(255, 248, 242, 0.96)"
      : "rgba(255, 255, 255, 0.74)"};
  cursor: pointer;
  font: inherit;

  strong {
    font-size: 0.74rem;
    line-height: 1.2;
    color: var(--ink);
  }

  span {
    font-size: 0.66rem;
    line-height: 1.32;
    color: var(--muted);
  }
`;

const TreeLeafMeta = styled.div`
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const DocumentImportPanel = styled.div`
  display: grid;
  gap: 0.46rem;
  padding: 0.68rem;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.76);
`;

const DocumentImportTitle = styled.h3`
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.2;
  color: var(--ink);
`;

const DocumentImportInput = styled.input`
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  padding: 0.54rem 0.68rem;
  font: inherit;
  font-size: 0.74rem;
`;

const DocumentHeaderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.38rem;
  align-items: center;
`;

const DocumentFileCard = styled.div`
  display: grid;
  gap: 0.34rem;
  padding: 0.58rem;
  border-radius: 12px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.78);
`;

const DocumentFileMeta = styled.div`
  display: grid;
  gap: 0.16rem;

  strong {
    font-size: 0.74rem;
    line-height: 1.2;
    color: var(--ink);
  }

  span {
    font-size: 0.66rem;
    line-height: 1.3;
    color: var(--muted);
  }
`;

const DocumentFileActions = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
`;

const InlineTextButton = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent-deep);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
`;

const EmptyTreeState = styled(MetaText)`
  padding: 0.2rem 0;
  font-size: 0.76rem;
`;

const AccountPaneShell = styled(OverviewPanel)`
  grid-template-rows: auto auto minmax(0, 1fr);
`;

const AccountPaneTitle = styled.h2`
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.08;
  color: var(--ink);
`;

const AccountPaneMeta = styled(MetaText)`
  margin: 0;
  font-size: 0.76rem;
`;

const MobilePaneTabs = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.12rem;
  width: fit-content;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.58);
`;

const MobilePaneTabButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0.42rem 0.8rem;
  background: ${({ $active }) => ($active ? "var(--ink)" : "transparent")};
  color: ${({ $active }) => ($active ? "#fffaf4" : "var(--muted)")};
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
`;

const MobilePaneStack = styled.section`
  min-height: 0;
`;

const MobilePane = styled.section`
  min-width: 0;
  min-height: 0;
`;
