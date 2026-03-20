import { useEffect, useId, useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { downloadWorkspaceFile, formatByteSize, openWorkspaceFileInNewTab } from "../lib/workspace-artifacts";
import type { ShellWorkspaceArtifact } from "../capabilities/types";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceDescriptor, WorkspaceKind } from "../types/workspace";

const PAGE_SIZE = 10;
const JSON_PREVIEW_LIMIT = 12;
const TEXT_PREVIEW_LIMIT = 4_000;

type TreeFolder = {
  label: string;
  folders: Map<string, TreeFolder>;
  files: ShellWorkspaceArtifact[];
};

type TreeRow =
  | {
      kind: "folder";
      key: string;
      label: string;
      depth: number;
    }
  | {
      kind: "file";
      key: string;
      artifact: ShellWorkspaceArtifact;
      depth: number;
    };

type TreeGroup = {
  key: string;
  label: string;
  rows: TreeRow[];
};

function compareArtifacts(left: ShellWorkspaceArtifact, right: ShellWorkspaceArtifact): number {
  return left.file.name.localeCompare(right.file.name) || left.path.localeCompare(right.path);
}

function compareWorkspaces(left: WorkspaceDescriptor, right: WorkspaceDescriptor): number {
  const order = (kind: WorkspaceKind): number => {
    switch (kind) {
      case "default":
        return 0;
      case "demo":
        return 1;
      case "user":
        return 2;
    }
  };
  return order(left.kind) - order(right.kind) || left.name.localeCompare(right.name);
}

function artifactSegments(artifact: ShellWorkspaceArtifact): string[] {
  const segments = artifact.path.split("/").filter(Boolean);
  if (segments[0] === artifact.producerKey) {
    return segments.slice(1);
  }
  if (artifact.producerKey === "uploaded" && segments[0] === "uploaded") {
    return segments.slice(1);
  }
  return segments;
}

function buildTreeGroups(artifacts: ShellWorkspaceArtifact[]): TreeGroup[] {
  const groups = new Map<string, { label: string; root: TreeFolder }>();

  for (const artifact of artifacts) {
    const relativeSegments = artifactSegments(artifact);
    const folderSegments = relativeSegments.slice(0, -1);
    let group = groups.get(artifact.producerKey);
    if (!group) {
      group = {
        label: artifact.producerLabel,
        root: {
          label: artifact.producerLabel,
          folders: new Map(),
          files: [],
        },
      };
      groups.set(artifact.producerKey, group);
    }
    let cursor = group.root;
    for (const segment of folderSegments) {
      const existing = cursor.folders.get(segment);
      if (existing) {
        cursor = existing;
        continue;
      }
      const nextFolder: TreeFolder = {
        label: segment,
        folders: new Map(),
        files: [],
      };
      cursor.folders.set(segment, nextFolder);
      cursor = nextFolder;
    }
    cursor.files.push(artifact);
  }

  function flattenRows(folder: TreeFolder, depth: number, parentKey: string): TreeRow[] {
    const rows: TreeRow[] = [];
    const folderEntries = Array.from(folder.folders.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [folderName, childFolder] of folderEntries) {
      const key = `${parentKey}/${folderName}`;
      rows.push({
        kind: "folder",
        key,
        label: childFolder.label,
        depth,
      });
      rows.push(...flattenRows(childFolder, depth + 1, key));
    }
    const fileRows = [...folder.files].sort(compareArtifacts).map(
      (artifact): TreeRow => ({
        kind: "file",
        key: artifact.entryId,
        artifact,
        depth,
      }),
    );
    rows.push(...fileRows);
    return rows;
  }

  return Array.from(groups.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      rows: flattenRows(value.root, 0, key),
    }))
    .sort((left, right) => {
      if (left.key === "uploaded") {
        return -1;
      }
      if (right.key === "uploaded") {
        return 1;
      }
      return left.label.localeCompare(right.label);
    });
}

function fileKindLabel(file: LocalWorkspaceFile): string {
  switch (file.kind) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "pdf":
      return "pdf";
    case "other":
      return file.extension || "file";
  }
}

function summarizeArtifactMeta(artifact: ShellWorkspaceArtifact): string {
  const file = artifact.file;
  const bits = [fileKindLabel(file)];
  if (typeof file.byte_size === "number") {
    bits.push(formatByteSize(file.byte_size));
  }
  if (file.kind === "csv" || file.kind === "json") {
    bits.push(`${file.row_count} rows`);
  }
  if (file.kind === "pdf") {
    bits.push(`${file.page_count} pages`);
  }
  return bits.join(" · ");
}

function canOpenInline(file: LocalWorkspaceFile): boolean {
  return file.kind === "pdf" || file.kind === "json" || (file.kind === "other" && file.text_content != null);
}

function parseChartArtifact(file: LocalWorkspaceFile): {
  title: string;
  imageDataUrl: string | null;
  chartPlanId: string | null;
} | null {
  if (file.kind !== "other" || !file.text_content) {
    return null;
  }
  try {
    const parsed = JSON.parse(file.text_content) as {
      title?: unknown;
      image_data_url?: unknown;
      chart_plan_id?: unknown;
      chart?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || !("chart" in parsed)) {
      return null;
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : file.name,
      imageDataUrl: typeof parsed.image_data_url === "string" ? parsed.image_data_url : null,
      chartPlanId: typeof parsed.chart_plan_id === "string" ? parsed.chart_plan_id : null,
    };
  } catch {
    return null;
  }
}

function renderArtifactPreview(
  file: LocalWorkspaceFile,
  currentPage: number,
  onSetPage: (nextPage: number) => void,
) {
  const chartArtifact = parseChartArtifact(file);
  if (chartArtifact) {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Chart preview</strong>
          <MetaText>
            {chartArtifact.chartPlanId ? `Plan ${chartArtifact.chartPlanId}` : "Saved chart metadata"}
          </MetaText>
        </PreviewSectionHeader>
        {chartArtifact.imageDataUrl ? (
          <PreviewImage alt={chartArtifact.title} src={chartArtifact.imageDataUrl} />
        ) : (
          <MetaText>Open or download this artifact to inspect the full chart definition.</MetaText>
        )}
      </PreviewSection>
    );
  }

  if (file.kind === "csv") {
    const previewRows = file.preview_rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    const pageCount = Math.max(1, Math.ceil(file.preview_rows.length / PAGE_SIZE));

    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Table preview</strong>
          <MetaText>Showing captured preview rows for this CSV artifact.</MetaText>
        </PreviewSectionHeader>
        <PreviewInlineStats>
          <PreviewInlineStat>{file.row_count} rows</PreviewInlineStat>
          <PreviewInlineStat>{file.columns.length} columns</PreviewInlineStat>
          <PreviewInlineStat>{file.numeric_columns.length} numeric</PreviewInlineStat>
        </PreviewInlineStats>
        <MetaText>Columns: {file.columns.join(", ")}</MetaText>
        <PreviewTableScroller>
          <PreviewTable>
            <thead>
              <tr>
                {file.columns.map((column) => (
                  <PreviewTh key={column}>{column}</PreviewTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr key={`${file.id}-${currentPage}-${rowIndex}`}>
                  {file.columns.map((column) => (
                    <PreviewTd key={`${file.id}-${rowIndex}-${column}`}>{String(row[column] ?? "")}</PreviewTd>
                  ))}
                </tr>
              ))}
            </tbody>
          </PreviewTable>
        </PreviewTableScroller>
        {pageCount > 1 ? (
          <PreviewPager>
            <PreviewPagerButton
              disabled={currentPage === 0}
              onClick={() => onSetPage(Math.max(0, currentPage - 1))}
              type="button"
            >
              Previous
            </PreviewPagerButton>
            <MetaText>
              Page {currentPage + 1} of {pageCount}
            </MetaText>
            <PreviewPagerButton
              disabled={currentPage >= pageCount - 1}
              onClick={() => onSetPage(Math.min(pageCount - 1, currentPage + 1))}
              type="button"
            >
              Next
            </PreviewPagerButton>
          </PreviewPager>
        ) : null}
      </PreviewSection>
    );
  }

  if (file.kind === "json") {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>JSON preview</strong>
          <MetaText>Showing the first {Math.min(file.row_count, JSON_PREVIEW_LIMIT)} rows.</MetaText>
        </PreviewSectionHeader>
        <PreviewInlineStats>
          <PreviewInlineStat>{file.row_count} rows</PreviewInlineStat>
          <PreviewInlineStat>{file.columns.length} columns</PreviewInlineStat>
          <PreviewInlineStat>{formatByteSize(file.byte_size ?? 0)}</PreviewInlineStat>
        </PreviewInlineStats>
        <PreviewCode>{JSON.stringify(file.rows.slice(0, JSON_PREVIEW_LIMIT), null, 2)}</PreviewCode>
      </PreviewSection>
    );
  }

  if (file.kind === "pdf") {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>PDF summary</strong>
          <MetaText>Open the file in a new tab for a full document view.</MetaText>
        </PreviewSectionHeader>
        <PreviewInlineStats>
          <PreviewInlineStat>{file.page_count} pages</PreviewInlineStat>
          <PreviewInlineStat>{formatByteSize(file.byte_size ?? 0)}</PreviewInlineStat>
        </PreviewInlineStats>
      </PreviewSection>
    );
  }

  if (file.text_content != null) {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Text preview</strong>
          <MetaText>Showing the first {Math.min(file.text_content.length, TEXT_PREVIEW_LIMIT)} characters.</MetaText>
        </PreviewSectionHeader>
        <PreviewText>{file.text_content.slice(0, TEXT_PREVIEW_LIMIT)}</PreviewText>
      </PreviewSection>
    );
  }

  return (
    <PreviewSection>
      <PreviewSectionHeader>
        <strong>Binary file</strong>
        <MetaText>Download this file to inspect it locally.</MetaText>
      </PreviewSectionHeader>
    </PreviewSection>
  );
}

export function WorkspaceInventoryPane({
  artifacts,
  workspaces,
  activeWorkspaceId,
  activeWorkspaceName,
  activeWorkspaceKind,
  accept,
  onSelectFiles,
  onSelectWorkspace,
  onCreateWorkspace,
  onClearWorkspace,
  clearActionLabel,
  clearActionDisabled,
  onRemoveArtifact,
}: {
  artifacts: ShellWorkspaceArtifact[];
  workspaces: WorkspaceDescriptor[];
  activeWorkspaceId: string;
  activeWorkspaceName: string;
  activeWorkspaceKind: WorkspaceKind;
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => WorkspaceDescriptor | null;
  onClearWorkspace: () => void;
  clearActionLabel: string;
  clearActionDisabled?: boolean;
  onRemoveArtifact?: (entryId: string) => void;
}) {
  const sortedWorkspaces = useMemo(() => [...workspaces].sort(compareWorkspaces), [workspaces]);
  const treeGroups = useMemo(() => buildTreeGroups(artifacts), [artifacts]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(artifacts[0]?.entryId ?? null);
  const [pageByArtifactId, setPageByArtifactId] = useState<Record<string, number>>({});
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const uploadInputId = useId();

  useEffect(() => {
    if (!artifacts.length) {
      setSelectedArtifactId(null);
      return;
    }
    setSelectedArtifactId((current) => {
      if (current && artifacts.some((artifact) => artifact.entryId === current)) {
        return current;
      }
      return artifacts[0].entryId;
    });
  }, [artifacts]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.entryId === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  );
  const sourceCounts = useMemo(
    () =>
      artifacts.reduce<Record<ShellWorkspaceArtifact["source"], number>>(
        (counts, artifact) => ({
          ...counts,
          [artifact.source]: counts[artifact.source] + 1,
        }),
        { uploaded: 0, derived: 0, demo: 0 },
      ),
    [artifacts],
  );

  return (
    <WorkspacePanel>
      <WorkspaceHeader>
        <div>
          <WorkspaceTitle>Workspace artifacts</WorkspaceTitle>
          <MetaText>
            Browse the selected workspace, switch contexts, add files, and inspect the latest derived outputs.
          </MetaText>
        </div>
        <WorkspaceCountPill>
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
        </WorkspaceCountPill>
      </WorkspaceHeader>

      <WorkspaceToolbar>
        <WorkspaceSelect
          aria-label="Active workspace"
          data-testid="workspace-select"
          onChange={(event) => onSelectWorkspace(event.target.value)}
          value={activeWorkspaceId}
        >
          {sortedWorkspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </WorkspaceSelect>

        {creatingWorkspace ? (
          <WorkspaceCreateForm
            onSubmit={(event) => {
              event.preventDefault();
              const created = onCreateWorkspace(newWorkspaceName);
              if (created) {
                setNewWorkspaceName("");
                setCreatingWorkspace(false);
              }
            }}
          >
            <WorkspaceCreateInput
              aria-label="New workspace name"
              data-testid="workspace-new-input"
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Workspace name"
              value={newWorkspaceName}
            />
            <WorkspaceInlineButton type="submit">Create</WorkspaceInlineButton>
            <WorkspaceInlineButton
              onClick={() => {
                setCreatingWorkspace(false);
                setNewWorkspaceName("");
              }}
              type="button"
            >
              Cancel
            </WorkspaceInlineButton>
          </WorkspaceCreateForm>
        ) : (
          <WorkspaceInlineButton
            data-testid="workspace-new-button"
            onClick={() => setCreatingWorkspace(true)}
            type="button"
          >
            New workspace
          </WorkspaceInlineButton>
        )}

        <WorkspaceUploadLabel htmlFor={uploadInputId}>Add files</WorkspaceUploadLabel>
        <WorkspaceUploadInput
          id={uploadInputId}
          type="file"
          accept={accept}
          multiple
          onChange={(event) => {
            void onSelectFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        <WorkspaceInlineButton
          data-testid="workspace-clear-button"
          disabled={clearActionDisabled}
          onClick={onClearWorkspace}
          type="button"
        >
          {clearActionLabel}
        </WorkspaceInlineButton>

        <WorkspaceSourceMeta>
          {sourceCounts.uploaded} uploaded, {sourceCounts.derived} derived, {sourceCounts.demo} demo
        </WorkspaceSourceMeta>
      </WorkspaceToolbar>

      <WorkspaceActiveMeta>
        <strong>{activeWorkspaceName}</strong>
        <MetaText>
          {activeWorkspaceKind === "demo"
            ? "Shared demo workspace"
            : "Shared app workspace"}
        </MetaText>
      </WorkspaceActiveMeta>

      <WorkspaceBrowser>
        <WorkspaceTreePane data-testid="workspace-tree-pane">
          {treeGroups.length ? (
            treeGroups.map((group) => (
              <WorkspaceGroup key={group.key}>
                <WorkspaceGroupLabel>{group.label}</WorkspaceGroupLabel>
                {group.rows.map((row) =>
                  row.kind === "folder" ? (
                    <WorkspaceFolderRow
                      key={row.key}
                      style={{ paddingLeft: `${0.9 + row.depth * 1.05}rem` }}
                    >
                      {row.label}
                    </WorkspaceFolderRow>
                  ) : (
                    <WorkspaceFileRow
                      key={row.key}
                      $selected={row.artifact.entryId === selectedArtifactId}
                    >
                      <WorkspaceFileSelect
                        onClick={() => setSelectedArtifactId(row.artifact.entryId)}
                        style={{ paddingLeft: `${0.9 + row.depth * 1.05}rem` }}
                        type="button"
                      >
                        <WorkspaceFileLead>
                          <WorkspaceFileName>{row.artifact.file.name}</WorkspaceFileName>
                          <WorkspaceFileMeta>{summarizeArtifactMeta(row.artifact)}</WorkspaceFileMeta>
                        </WorkspaceFileLead>
                      </WorkspaceFileSelect>
                      <WorkspaceFileActions>
                        <WorkspaceRowAction
                          onClick={(event) => {
                            openWorkspaceFileInNewTab(row.artifact.file);
                          }}
                          type="button"
                        >
                          Open
                        </WorkspaceRowAction>
                        <WorkspaceRowAction
                          onClick={(event) => {
                            downloadWorkspaceFile(row.artifact.file);
                          }}
                          type="button"
                        >
                          Download
                        </WorkspaceRowAction>
                        {onRemoveArtifact ? (
                          <WorkspaceRowAction
                            onClick={(event) => {
                              onRemoveArtifact(row.artifact.entryId);
                            }}
                            type="button"
                          >
                            Remove
                          </WorkspaceRowAction>
                        ) : null}
                      </WorkspaceFileActions>
                    </WorkspaceFileRow>
                  ),
                )}
              </WorkspaceGroup>
            ))
          ) : (
            <WorkspaceEmptyState>No artifacts yet. Add files or run an agent to populate this workspace.</WorkspaceEmptyState>
          )}
        </WorkspaceTreePane>

        <WorkspacePreviewPane data-testid="workspace-preview-pane">
          {selectedArtifact ? (
            <>
              <WorkspacePreviewHeader>
                <div>
                  <WorkspacePreviewTitle>{selectedArtifact.file.name}</WorkspacePreviewTitle>
                  <MetaText>{selectedArtifact.path}</MetaText>
                </div>
                <WorkspacePreviewMeta>
                  <WorkspacePreviewBadge>{selectedArtifact.source}</WorkspacePreviewBadge>
                  <WorkspacePreviewBadge>{fileKindLabel(selectedArtifact.file)}</WorkspacePreviewBadge>
                </WorkspacePreviewMeta>
              </WorkspacePreviewHeader>
              <WorkspacePreviewMetaStrip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Producer</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>{selectedArtifact.producerLabel}</WorkspaceMetaValue>
                </WorkspaceMetaChip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Size</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>{formatByteSize(selectedArtifact.file.byte_size ?? 0)}</WorkspaceMetaValue>
                </WorkspaceMetaChip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Created</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>{new Date(selectedArtifact.createdAt).toLocaleDateString()}</WorkspaceMetaValue>
                </WorkspaceMetaChip>
              </WorkspacePreviewMetaStrip>
              {renderArtifactPreview(
                selectedArtifact.file,
                pageByArtifactId[selectedArtifact.entryId] ?? 0,
                (nextPage) =>
                  setPageByArtifactId((current) => ({
                    ...current,
                    [selectedArtifact.entryId]: nextPage,
                  })),
              )}
              {canOpenInline(selectedArtifact.file) ? null : (
                <MetaText>
                  Open or download this file for a fuller inspection path.
                </MetaText>
              )}
            </>
          ) : (
            <WorkspaceEmptyState>Select an artifact to inspect its preview and actions.</WorkspaceEmptyState>
          )}
        </WorkspacePreviewPane>
      </WorkspaceBrowser>
    </WorkspacePanel>
  );
}

const WorkspacePanel = styled.section`
  display: grid;
  gap: 0.8rem;
  min-height: 0;
`;

const WorkspaceHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
`;

const WorkspaceTitle = styled.h2`
  margin: 0;
  font-size: 1.05rem;
`;

const WorkspaceCountPill = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0.34rem 0.65rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.72);
  font-size: 0.76rem;
  font-weight: 700;
`;

const WorkspaceToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const WorkspaceSelect = styled.select`
  min-width: 200px;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.5rem 0.8rem;
  font: inherit;
`;

const WorkspaceCreateForm = styled.form`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
`;

const WorkspaceCreateInput = styled.input`
  min-width: 180px;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.5rem 0.8rem;
  font: inherit;
`;

const WorkspaceInlineButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  padding: 0.45rem 0.75rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.46;
  }
`;

const WorkspaceUploadLabel = styled.label`
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(31, 41, 55, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  padding: 0.45rem 0.75rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
`;

const WorkspaceUploadInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

const WorkspaceSourceMeta = styled(MetaText)`
  margin-left: auto;
  white-space: nowrap;
`;

const WorkspaceActiveMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const WorkspaceBrowser = styled.div`
  display: grid;
  grid-template-columns: minmax(300px, 0.95fr) minmax(320px, 1.1fr);
  gap: 0.8rem;
  min-height: min(64vh, 720px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    min-height: 0;
  }
`;

const WorkspaceTreePane = styled.section`
  min-height: 0;
  max-height: min(64vh, 720px);
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.74);
  padding: 0.65rem;
`;

const WorkspacePreviewPane = styled.section`
  min-height: 0;
  max-height: min(64vh, 720px);
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.74);
  padding: 0.85rem;
  display: grid;
  align-content: start;
  gap: 0.8rem;
`;

const WorkspaceGroup = styled.section`
  display: grid;
  gap: 0.14rem;

  & + & {
    margin-top: 0.7rem;
  }
`;

const WorkspaceGroupLabel = styled.div`
  padding: 0.18rem 0.32rem 0.36rem;
  color: var(--accent-deep);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const WorkspaceFolderRow = styled.div`
  padding-block: 0.34rem;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 700;
`;

const WorkspaceFileRow = styled.div<{ $selected: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  border: 1px solid ${({ $selected }) => ($selected ? "rgba(201, 111, 59, 0.24)" : "transparent")};
  border-radius: 12px;
  background: ${({ $selected }) => ($selected ? "rgba(201, 111, 59, 0.08)" : "transparent")};
`;

const WorkspaceFileSelect = styled.button`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  border: 0;
  background: transparent;
  padding-block: 0.45rem;
  text-align: left;
  cursor: pointer;
`;

const WorkspaceFileLead = styled.div`
  min-width: 0;
  display: grid;
  gap: 0.08rem;
`;

const WorkspaceFileName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ink);
`;

const WorkspaceFileMeta = styled.span`
  color: var(--muted);
  font-size: 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceFileActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
  flex: 0 0 auto;
`;

const WorkspaceRowAction = styled.button`
  border: 0;
  background: transparent;
  color: var(--accent-deep);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  padding: 0.1rem 0.16rem;
`;

const WorkspacePreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
`;

const WorkspacePreviewTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
`;

const WorkspacePreviewMeta = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const WorkspacePreviewBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(201, 111, 59, 0.22);
  background: rgba(201, 111, 59, 0.08);
  padding: 0.18rem 0.46rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--accent-deep);
`;

const WorkspaceEmptyState = styled.div`
  padding: 1rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.58);
  color: var(--muted);
  font-size: 0.82rem;
`;

const PreviewSection = styled.section`
  display: grid;
  gap: 0.7rem;
`;

const PreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.15rem;
`;

const WorkspacePreviewMetaStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
`;

const WorkspaceMetaChip = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.38rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.72);
`;

const WorkspaceMetaLabel = styled.span`
  color: var(--muted);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const WorkspaceMetaValue = styled.span`
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink);
`;

const PreviewInlineStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
`;

const PreviewInlineStat = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0.24rem 0.48rem;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.06);
  color: var(--muted);
  font-size: 0.73rem;
`;

const PreviewTableScroller = styled.div`
  overflow: auto;
`;

const PreviewTable = styled.table`
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
`;

const PreviewTh = styled.th`
  padding: 0.62rem 0.7rem;
  text-align: left;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(31, 41, 55, 0.04);
  font-size: 0.78rem;
`;

const PreviewTd = styled.td`
  padding: 0.62rem 0.7rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.06);
  font-size: 0.78rem;
  vertical-align: top;
`;

const PreviewPager = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
`;

const PreviewPagerButton = styled(WorkspaceInlineButton)`
  padding-inline: 0.62rem;
`;

const PreviewCode = styled.pre`
  margin: 0;
  padding: 0.9rem;
  border-radius: var(--radius-md);
  background: #221f1b;
  color: #f8f6f2;
  overflow: auto;
  font-size: 0.8rem;
`;

const PreviewText = styled.pre`
  margin: 0;
  padding: 0.9rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(31, 41, 55, 0.08);
  white-space: pre-wrap;
  overflow: auto;
  font-size: 0.8rem;
`;

const PreviewImage = styled.img`
  width: 100%;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.72);
`;
