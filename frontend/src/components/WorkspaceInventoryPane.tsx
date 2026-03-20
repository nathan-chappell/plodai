import { useEffect, useId, useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import type {
  PdfSmartSplitBundleView,
  ShellWorkspaceArtifact,
} from "../capabilities/types";
import { buildSmartSplitGroups } from "./pdfSmartSplitGroups";
import {
  downloadWorkspaceFile,
  formatByteSize,
  openWorkspaceFileInNewTab,
} from "../lib/workspace-artifacts";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceDescriptor, WorkspaceKind } from "../types/workspace";

const PAGE_SIZE = 10;
const JSON_PREVIEW_LIMIT = 12;
const TEXT_PREVIEW_LIMIT = 4_000;
const EMPTY_SMART_SPLIT_BUNDLES: PdfSmartSplitBundleView[] = [];

type TreeFolder = {
  key: string;
  label: string;
  folders: Map<string, TreeFolder>;
  files: ShellWorkspaceArtifact[];
};

type TreeGroup = {
  key: string;
  label: string;
  root: TreeFolder;
};

function compareArtifacts(
  left: ShellWorkspaceArtifact,
  right: ShellWorkspaceArtifact,
): number {
  return (
    left.bucket.localeCompare(right.bucket) ||
    left.producerLabel.localeCompare(right.producerLabel) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.file.name.localeCompare(right.file.name)
  );
}

function compareWorkspaces(
  left: WorkspaceDescriptor,
  right: WorkspaceDescriptor,
): number {
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
  return [bucketLabel(artifact.bucket), artifact.file.name];
}

function buildTreeGroups(artifacts: ShellWorkspaceArtifact[]): TreeGroup[] {
  const groups = new Map<string, TreeGroup>();

  for (const artifact of artifacts) {
    const relativeSegments = artifactSegments(artifact);
    const folderSegments = relativeSegments.slice(0, -1);
    const groupKey = `group:${artifact.producerKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        label: artifact.producerLabel,
        root: {
          key: groupKey,
          label: artifact.producerLabel,
          folders: new Map(),
          files: [],
        },
      };
      groups.set(groupKey, group);
    }

    let cursor = group.root;
    for (const segment of folderSegments) {
      const folderKey = `${cursor.key}/${segment}`;
      const existing = cursor.folders.get(segment);
      if (existing) {
        cursor = existing;
        continue;
      }
      const nextFolder: TreeFolder = {
        key: folderKey,
        label: segment,
        folders: new Map(),
        files: [],
      };
      cursor.folders.set(segment, nextFolder);
      cursor = nextFolder;
    }
    cursor.files.push(artifact);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.key === "group:uploaded") {
      return -1;
    }
    if (right.key === "group:uploaded") {
      return 1;
    }
    return left.label.localeCompare(right.label);
  });
}

function buildArtifactKeyChain(
  artifact: ShellWorkspaceArtifact,
): { groupKey: string; folderKeys: string[] } {
  const groupKey = `group:${artifact.producerKey}`;
  const folderSegments = artifactSegments(artifact).slice(0, -1);
  const folderKeys: string[] = [];
  let cursorKey = groupKey;
  for (const segment of folderSegments) {
    cursorKey = `${cursorKey}/${segment}`;
    folderKeys.push(cursorKey);
  }
  return { groupKey, folderKeys };
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

function bucketLabel(bucket: ShellWorkspaceArtifact["bucket"]): string {
  switch (bucket) {
    case "uploaded":
      return "Uploads";
    case "data":
      return "Data";
    case "chart":
      return "Charts";
    case "pdf":
      return "PDF";
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
  return (
    file.kind === "pdf" ||
    file.kind === "json" ||
    (file.kind === "other" && file.text_content != null)
  );
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
      imageDataUrl:
        typeof parsed.image_data_url === "string" ? parsed.image_data_url : null,
      chartPlanId:
        typeof parsed.chart_plan_id === "string" ? parsed.chart_plan_id : null,
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
            {chartArtifact.chartPlanId
              ? `Plan ${chartArtifact.chartPlanId}`
              : "Saved chart metadata"}
          </MetaText>
        </PreviewSectionHeader>
        {chartArtifact.imageDataUrl ? (
          <PreviewImage alt={chartArtifact.title} src={chartArtifact.imageDataUrl} />
        ) : (
          <MetaText>
            Open or download this artifact to inspect the full chart definition.
          </MetaText>
        )}
      </PreviewSection>
    );
  }

  if (file.kind === "csv") {
    const previewRows = file.preview_rows.slice(
      currentPage * PAGE_SIZE,
      (currentPage + 1) * PAGE_SIZE,
    );
    const pageCount = Math.max(
      1,
      Math.ceil(file.preview_rows.length / PAGE_SIZE),
    );

    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Table preview</strong>
        </PreviewSectionHeader>
        <PreviewInlineStats>
          <PreviewInlineStat>{file.row_count} rows</PreviewInlineStat>
          <PreviewInlineStat>{file.columns.length} columns</PreviewInlineStat>
        </PreviewInlineStats>
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
                    <PreviewTd key={`${file.id}-${rowIndex}-${column}`}>
                      {String(row[column] ?? "")}
                    </PreviewTd>
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
          <MetaText>
            Showing the first {Math.min(file.row_count, JSON_PREVIEW_LIMIT)} rows.
          </MetaText>
        </PreviewSectionHeader>
        <PreviewInlineStats>
          <PreviewInlineStat>{file.row_count} rows</PreviewInlineStat>
          <PreviewInlineStat>{file.columns.length} columns</PreviewInlineStat>
          <PreviewInlineStat>{formatByteSize(file.byte_size ?? 0)}</PreviewInlineStat>
        </PreviewInlineStats>
        <PreviewCode>
          {JSON.stringify(file.rows.slice(0, JSON_PREVIEW_LIMIT), null, 2)}
        </PreviewCode>
      </PreviewSection>
    );
  }

  if (file.kind === "pdf") {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>PDF summary</strong>
          <MetaText>
            Open the file in a new tab for a full document view. {file.page_count} pages
            {" · "}
            {formatByteSize(file.byte_size ?? 0)}
          </MetaText>
        </PreviewSectionHeader>
      </PreviewSection>
    );
  }

  if (file.text_content != null) {
    return (
      <PreviewSection>
        <PreviewSectionHeader>
          <strong>Text preview</strong>
          <MetaText>
            Showing the first{" "}
            {Math.min(file.text_content.length, TEXT_PREVIEW_LIMIT)} characters.
          </MetaText>
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
  smartSplitBundles = EMPTY_SMART_SPLIT_BUNDLES,
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
  smartSplitBundles?: PdfSmartSplitBundleView[];
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
  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort(compareWorkspaces),
    [workspaces],
  );
  const rawTreeGroups = useMemo(() => buildTreeGroups(artifacts), [artifacts]);
  const smartSplitGroups = useMemo(
    () => buildSmartSplitGroups(smartSplitBundles, artifacts),
    [artifacts, smartSplitBundles],
  );
  const smartSplitArtifactIds = useMemo(
    () =>
      new Set(
        smartSplitGroups.flatMap((group) =>
          group.rows.map((row) => row.artifact.entryId),
        ),
      ),
    [smartSplitGroups],
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    smartSplitGroups[0]?.rows[0]?.artifact.entryId ?? artifacts[0]?.entryId ?? null,
  );
  const [pageByArtifactId, setPageByArtifactId] = useState<Record<string, number>>(
    {},
  );
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [artifactBrowserOpen, setArtifactBrowserOpen] = useState(
    smartSplitGroups.length === 0,
  );
  const [confirmingWorkspaceReset, setConfirmingWorkspaceReset] = useState(false);
  const [openGroupKeys, setOpenGroupKeys] = useState<Record<string, boolean>>({});
  const [openFolderKeys, setOpenFolderKeys] = useState<Record<string, boolean>>({});
  const uploadInputId = useId();
  const clearActionDescription = clearActionLabel.toLowerCase().includes("reset")
    ? `Reset ${activeWorkspaceName} to its seeded demo contents?`
    : `Clear all uploaded and derived artifacts from ${activeWorkspaceName}?`;

  useEffect(() => {
    setArtifactBrowserOpen((current) =>
      smartSplitGroups.length === 0 ? true : current,
    );
  }, [smartSplitGroups.length]);

  useEffect(() => {
    const fallbackArtifactId =
      smartSplitGroups[0]?.rows[0]?.artifact.entryId ?? artifacts[0]?.entryId ?? null;
    if (!artifacts.length) {
      setSelectedArtifactId(null);
      return;
    }
    setSelectedArtifactId((current) => {
      if (current && artifacts.some((artifact) => artifact.entryId === current)) {
        return current;
      }
      return fallbackArtifactId;
    });
  }, [artifacts, smartSplitGroups]);

  const selectedArtifact = useMemo(
    () =>
      artifacts.find((artifact) => artifact.entryId === selectedArtifactId) ??
      null,
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

  useEffect(() => {
    if (!selectedArtifact) {
      return;
    }
    const chain = buildArtifactKeyChain(selectedArtifact);
    const selectedInSmartSplit = smartSplitArtifactIds.has(selectedArtifact.entryId);
    if (!selectedInSmartSplit) {
      setArtifactBrowserOpen(true);
    }
    if (selectedInSmartSplit && !artifactBrowserOpen) {
      return;
    }
    setOpenGroupKeys((current) => ({ ...current, [chain.groupKey]: true }));
    if (chain.folderKeys.length) {
      setOpenFolderKeys((current) => ({
        ...current,
        ...Object.fromEntries(chain.folderKeys.map((key) => [key, true])),
      }));
    }
  }, [artifactBrowserOpen, selectedArtifact, smartSplitArtifactIds]);

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
          onClick={() => setConfirmingWorkspaceReset(true)}
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
          {activeWorkspaceKind === "demo" ? "Shared demo workspace" : "Shared app workspace"}
        </MetaText>
      </WorkspaceActiveMeta>

      <WorkspaceBrowser>
        <WorkspaceTreePane data-testid="workspace-tree-pane">
          {smartSplitGroups.length ? (
            <TreeSection>
              <TreeSectionLabel>Smart split bundles</TreeSectionLabel>
              {smartSplitGroups.map((group) => (
                <SmartSplitBundleCard key={group.bundle.id}>
                  <SmartSplitBundleTitle>
                    {group.bundle.sourceFileName}
                  </SmartSplitBundleTitle>
                  <SmartSplitBundleMeta>
                    {group.rows.filter((row) => row.kind === "entry").length} splits
                  </SmartSplitBundleMeta>
                  <SmartSplitNodeList>
                    {group.rows.map((row) => (
                      <SmartSplitNode
                        key={row.key}
                        $selected={row.artifact.entryId === selectedArtifactId}
                      >
                        <SmartSplitNodeButton
                          onClick={() => setSelectedArtifactId(row.artifact.entryId)}
                          type="button"
                        >
                          <SmartSplitNodeKind>{row.kind}</SmartSplitNodeKind>
                          <SmartSplitNodeLead>
                            <SmartSplitNodeLabel>{row.label}</SmartSplitNodeLabel>
                            <SmartSplitNodeMeta>{row.meta}</SmartSplitNodeMeta>
                          </SmartSplitNodeLead>
                        </SmartSplitNodeButton>
                      </SmartSplitNode>
                    ))}
                  </SmartSplitNodeList>
                </SmartSplitBundleCard>
              ))}
            </TreeSection>
          ) : null}

          {artifacts.length ? (
            <TreeSection>
              <TreeSectionToggle
                aria-expanded={artifactBrowserOpen}
                onClick={() => setArtifactBrowserOpen((current) => !current)}
                type="button"
              >
                <TreeSectionChevron $expanded={artifactBrowserOpen}>▾</TreeSectionChevron>
                <div>
                  <TreeSectionLabel>Convenience output files</TreeSectionLabel>
                  <MetaText>
                    Raw uploaded and derived files, grouped by producer and artifact type.
                  </MetaText>
                </div>
              </TreeSectionToggle>

              {artifactBrowserOpen ? (
                rawTreeGroups.length ? (
                  rawTreeGroups.map((group) => (
                    <RawGroup key={group.key}>
                      <RawGroupToggle
                        aria-expanded={openGroupKeys[group.key] ?? false}
                        onClick={() =>
                          setOpenGroupKeys((current) => ({
                            ...current,
                            [group.key]: !current[group.key],
                          }))
                        }
                        type="button"
                      >
                        <TreeSectionChevron
                          $expanded={openGroupKeys[group.key] ?? false}
                        >
                          ▾
                        </TreeSectionChevron>
                        <RawGroupLabel>{group.label}</RawGroupLabel>
                      </RawGroupToggle>
                      {openGroupKeys[group.key] ?? false ? (
                        <RawGroupContent>
                          <RawFolderTree
                            folder={group.root}
                            depth={0}
                            selectedArtifactId={selectedArtifactId}
                            openFolderKeys={openFolderKeys}
                            onToggleFolder={(folderKey) =>
                              setOpenFolderKeys((current) => ({
                                ...current,
                                [folderKey]: !current[folderKey],
                              }))
                            }
                            onSelectArtifact={setSelectedArtifactId}
                          />
                        </RawGroupContent>
                      ) : null}
                    </RawGroup>
                  ))
                ) : (
                  <WorkspaceEmptyState>
                    No artifacts yet. Add files or run an agent to populate this workspace.
                  </WorkspaceEmptyState>
                )
              ) : null}
            </TreeSection>
          ) : (
            <WorkspaceEmptyState>
              No artifacts yet. Add files or run an agent to populate this workspace.
            </WorkspaceEmptyState>
          )}
        </WorkspaceTreePane>

        <WorkspacePreviewPane data-testid="workspace-preview-pane">
          {selectedArtifact ? (
            <>
              <WorkspacePreviewHeader>
                <div>
                  <WorkspacePreviewTitle>{selectedArtifact.file.name}</WorkspacePreviewTitle>
                  <MetaText>
                    {selectedArtifact.producerLabel} · {bucketLabel(selectedArtifact.bucket)}
                  </MetaText>
                </div>
                <WorkspacePreviewActions>
                  <WorkspaceActionButton
                    onClick={() => openWorkspaceFileInNewTab(selectedArtifact.file)}
                    type="button"
                  >
                    Open
                  </WorkspaceActionButton>
                  <WorkspaceActionButton
                    onClick={() => downloadWorkspaceFile(selectedArtifact.file)}
                    type="button"
                  >
                    Download
                  </WorkspaceActionButton>
                  {onRemoveArtifact ? (
                    <WorkspaceActionButton
                      onClick={() => onRemoveArtifact(selectedArtifact.entryId)}
                      type="button"
                    >
                      Remove
                    </WorkspaceActionButton>
                  ) : null}
                </WorkspacePreviewActions>
              </WorkspacePreviewHeader>
              <WorkspacePreviewMetaStrip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Producer</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>{selectedArtifact.producerLabel}</WorkspaceMetaValue>
                </WorkspaceMetaChip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Size</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>
                    {formatByteSize(selectedArtifact.file.byte_size ?? 0)}
                  </WorkspaceMetaValue>
                </WorkspaceMetaChip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Created</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>
                    {new Date(selectedArtifact.createdAt).toLocaleDateString()}
                  </WorkspaceMetaValue>
                </WorkspaceMetaChip>
                <WorkspaceMetaChip>
                  <WorkspaceMetaLabel>Type</WorkspaceMetaLabel>
                  <WorkspaceMetaValue>{fileKindLabel(selectedArtifact.file)}</WorkspaceMetaValue>
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
            <WorkspaceEmptyState>
              Select an artifact to inspect its preview and actions.
            </WorkspaceEmptyState>
          )}
        </WorkspacePreviewPane>
      </WorkspaceBrowser>
      {confirmingWorkspaceReset ? (
        <ConfirmOverlay
          aria-modal="true"
          onClick={() => setConfirmingWorkspaceReset(false)}
          role="dialog"
        >
          <ConfirmDialog onClick={(event) => event.stopPropagation()}>
            <ConfirmTitle>{clearActionLabel}</ConfirmTitle>
            <MetaText>{clearActionDescription}</MetaText>
            <MetaText>
              This action affects the shared workspace and cannot be undone.
            </MetaText>
            <ConfirmActions>
              <WorkspaceInlineButton
                onClick={() => setConfirmingWorkspaceReset(false)}
                type="button"
              >
                Cancel
              </WorkspaceInlineButton>
              <ConfirmPrimaryButton
                onClick={() => {
                  onClearWorkspace();
                  setConfirmingWorkspaceReset(false);
                }}
                type="button"
              >
                {clearActionLabel}
              </ConfirmPrimaryButton>
            </ConfirmActions>
          </ConfirmDialog>
        </ConfirmOverlay>
      ) : null}
    </WorkspacePanel>
  );
}

function RawFolderTree({
  folder,
  depth,
  selectedArtifactId,
  openFolderKeys,
  onToggleFolder,
  onSelectArtifact,
}: {
  folder: TreeFolder;
  depth: number;
  selectedArtifactId: string | null;
  openFolderKeys: Record<string, boolean>;
  onToggleFolder: (folderKey: string) => void;
  onSelectArtifact: (artifactId: string) => void;
}) {
  const childFolders = Array.from(folder.folders.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  const files = [...folder.files].sort(compareArtifacts);

  return (
    <RawTreeList>
      {childFolders.map((childFolder) => {
        const isOpen = openFolderKeys[childFolder.key] ?? false;
        return (
          <RawTreeListItem key={childFolder.key}>
            <RawFolderToggle
              aria-expanded={isOpen}
              onClick={() => onToggleFolder(childFolder.key)}
              style={{ paddingLeft: `${0.7 + depth * 0.8}rem` }}
              type="button"
            >
              <TreeSectionChevron $expanded={isOpen}>▾</TreeSectionChevron>
              <span>{childFolder.label}</span>
            </RawFolderToggle>
            {isOpen ? (
              <RawFolderTree
                folder={childFolder}
                depth={depth + 1}
                selectedArtifactId={selectedArtifactId}
                openFolderKeys={openFolderKeys}
                onToggleFolder={onToggleFolder}
                onSelectArtifact={onSelectArtifact}
              />
            ) : null}
          </RawTreeListItem>
        );
      })}
      {files.map((artifact) => (
        <RawTreeListItem key={artifact.entryId}>
          <RawFileRow $selected={artifact.entryId === selectedArtifactId}>
            <RawFileButton
              onClick={() => onSelectArtifact(artifact.entryId)}
              style={{ paddingLeft: `${1.65 + depth * 0.8}rem` }}
              type="button"
            >
              <RawFileLead>
                <RawFileName>{artifact.file.name}</RawFileName>
                <RawFileMeta>{summarizeArtifactMeta(artifact)}</RawFileMeta>
              </RawFileLead>
            </RawFileButton>
          </RawFileRow>
        </RawTreeListItem>
      ))}
    </RawTreeList>
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
  padding: 0.28rem 0.58rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.18);
  background: rgba(255, 255, 255, 0.78);
  font-size: 0.74rem;
  font-weight: 700;
`;

const WorkspaceToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
`;

const WorkspaceSelect = styled.select`
  min-width: 200px;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.18);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.42rem 0.72rem;
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
  border: 1px solid rgba(31, 41, 55, 0.18);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.42rem 0.72rem;
  font: inherit;
`;

const WorkspaceInlineButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  padding: 0.38rem 0.68rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    background: rgba(249, 244, 236, 0.96);
    border-color: rgba(31, 41, 55, 0.3);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: default;
    opacity: 0.46;
  }
`;

const WorkspaceUploadLabel = styled.label`
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  padding: 0.38rem 0.68rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease,
    transform 160ms ease;

  &:hover {
    background: rgba(249, 244, 236, 0.96);
    border-color: rgba(31, 41, 55, 0.3);
    transform: translateY(-1px);
  }
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
  gap: 0.65rem;
  min-height: min(64vh, 720px);

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
    min-height: 0;
  }
`;

const WorkspaceTreePane = styled.section`
  display: grid;
  align-content: start;
  gap: 0.55rem;
  min-height: 0;
  max-height: min(64vh, 720px);
  overflow: auto;
  padding: 0.12rem 0.1rem 0.12rem 0;
`;

const TreeSection = styled.section`
  display: grid;
  gap: 0.35rem;
`;

const TreeSectionLabel = styled.div`
  color: var(--accent-deep);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const TreeSectionToggle = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 0.38rem;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
`;

const TreeSectionChevron = styled.span<{ $expanded: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  color: rgba(31, 41, 55, 0.58);
  transform: rotate(${({ $expanded }) => ($expanded ? "0deg" : "-90deg")});
  transition: transform 160ms ease;
`;

const SmartSplitBundleCard = styled.section`
  display: grid;
  gap: 0.24rem;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.6rem 0.68rem;
`;

const SmartSplitBundleTitle = styled.div`
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SmartSplitBundleMeta = styled(MetaText)`
  font-size: 0.73rem;
`;

const SmartSplitNodeList = styled.div`
  display: grid;
  gap: 0.18rem;
  margin-top: 0.25rem;
`;

const SmartSplitNode = styled.div<{ $selected: boolean }>`
  border-radius: var(--radius-md);
  background: ${({ $selected }) =>
    $selected ? "rgba(202, 106, 46, 0.1)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(143, 73, 35, 0.34)" : "transparent"};
  transition: background-color 160ms ease, border-color 160ms ease;
`;

const SmartSplitNodeButton = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0.38rem 0.5rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: transform 160ms ease;

  &:hover {
    transform: translateX(1px);
  }
`;

const SmartSplitNodeKind = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.6rem;
  padding: 0.16rem 0.4rem;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.07);
  color: rgba(31, 41, 55, 0.72);
  font-size: 0.63rem;
  font-weight: 700;
  text-transform: uppercase;
`;

const SmartSplitNodeLead = styled.div`
  display: grid;
  gap: 0.05rem;
  min-width: 0;
`;

const SmartSplitNodeLabel = styled.div`
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SmartSplitNodeMeta = styled(MetaText)`
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RawGroup = styled.section`
  display: grid;
  gap: 0.18rem;
`;

const RawGroupToggle = styled.button`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
`;

const RawGroupLabel = styled.div`
  font-size: 0.83rem;
  font-weight: 700;
`;

const RawGroupContent = styled.div`
  display: grid;
  gap: 0.16rem;
`;

const RawTreeList = styled.div`
  display: grid;
  gap: 0.14rem;
`;

const RawTreeListItem = styled.div`
  display: grid;
  gap: 0.12rem;
`;

const RawFolderToggle = styled.button`
  display: flex;
  align-items: center;
  gap: 0.28rem;
  border: 0;
  background: transparent;
  padding: 0.22rem 0.34rem;
  color: rgba(31, 41, 55, 0.72);
  text-align: left;
  font: inherit;
  font-size: 0.74rem;
  cursor: pointer;
`;

const RawFileRow = styled.div<{ $selected: boolean }>`
  border-radius: var(--radius-md);
  background: ${({ $selected }) =>
    $selected ? "rgba(202, 106, 46, 0.1)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "rgba(143, 73, 35, 0.34)" : "transparent"};
  transition: background-color 160ms ease, border-color 160ms ease;
`;

const RawFileButton = styled.button`
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0.32rem 0.4rem;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: transform 160ms ease;

  &:hover {
    transform: translateX(1px);
  }
`;

const RawFileLead = styled.div`
  display: grid;
  gap: 0.05rem;
  min-width: 0;
`;

const RawFileName = styled.div`
  min-width: 0;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.18;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RawFileMeta = styled(MetaText)`
  font-size: 0.71rem;
`;

const WorkspacePreviewPane = styled.section`
  min-height: 0;
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  padding: 0.78rem;
  display: grid;
  align-content: start;
  gap: 0.6rem;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.05);
`;

const WorkspacePreviewHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
`;

const WorkspacePreviewTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
  line-height: 1.22;
`;

const WorkspacePreviewActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const WorkspaceActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--ink);
  padding: 0.36rem 0.68rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease,
    transform 160ms ease;

  &:hover {
    background: rgba(249, 244, 236, 0.96);
    border-color: rgba(31, 41, 55, 0.3);
    transform: translateY(-1px);
  }
`;

const WorkspacePreviewMetaStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 0.35rem;
`;

const WorkspaceMetaChip = styled.div`
  display: grid;
  gap: 0.08rem;
  padding: 0.42rem 0.48rem;
  border-radius: 10px;
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(248, 244, 238, 0.84);
`;

const WorkspaceMetaLabel = styled.span`
  color: rgba(31, 41, 55, 0.54);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const WorkspaceMetaValue = styled.span`
  font-size: 0.74rem;
  font-weight: 700;
`;

const WorkspaceEmptyState = styled(MetaText)`
  padding: 0.2rem 0;
`;

const PreviewSection = styled.div`
  display: grid;
  gap: 0.48rem;
`;

const PreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.15rem;
`;

const PreviewInlineStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
`;

const PreviewInlineStat = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.46rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.86);
  font-size: 0.7rem;
  font-weight: 700;
`;

const PreviewImage = styled.img`
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.14);
  background: rgba(250, 247, 242, 0.88);
`;

const PreviewTableScroller = styled.div`
  overflow: auto;
  max-height: 260px;
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: var(--radius-md);
`;

const PreviewTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.74rem;
`;

const PreviewTh = styled.th`
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.42rem 0.55rem;
  background: rgba(252, 248, 242, 0.98);
  color: var(--ink);
  text-align: left;
  border-bottom: 1px solid rgba(31, 41, 55, 0.14);
`;

const PreviewTd = styled.td`
  padding: 0.38rem 0.55rem;
  border-bottom: 1px solid rgba(31, 41, 55, 0.08);
  vertical-align: top;
`;

const PreviewPager = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
`;

const PreviewPagerButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--ink);
  padding: 0.32rem 0.64rem;
  font: inherit;
  font-size: 0.73rem;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }
`;

const PreviewCode = styled.pre`
  margin: 0;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.16);
  background: rgba(20, 24, 31, 0.94);
  color: #eff8ff;
  padding: 0.72rem 0.82rem;
  font-size: 0.72rem;
  line-height: 1.45;
`;

const PreviewText = styled.pre`
  margin: 0;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.16);
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  padding: 0.72rem 0.82rem;
  font-size: 0.74rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const ConfirmOverlay = styled.div`
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(6px);
  z-index: 40;
  animation: fadeIn 140ms ease;

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const ConfirmDialog = styled.div`
  width: min(420px, 100%);
  display: grid;
  gap: 0.55rem;
  padding: 1rem;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.22);
  background: rgba(255, 252, 248, 0.96);
  box-shadow: 0 28px 64px rgba(15, 23, 42, 0.16);
  animation: confirmRise 180ms ease;

  @keyframes confirmRise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const ConfirmTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
`;

const ConfirmActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.1rem;
`;

const ConfirmPrimaryButton = styled(WorkspaceInlineButton)`
  background: rgba(31, 41, 55, 0.94);
  border-color: rgba(31, 41, 55, 0.94);
  color: white;

  &:hover:not(:disabled) {
    background: rgba(17, 24, 39, 0.96);
    border-color: rgba(17, 24, 39, 0.96);
  }
`;
