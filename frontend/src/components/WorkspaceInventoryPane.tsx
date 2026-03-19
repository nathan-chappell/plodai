import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  DatasetInventoryButton,
  DatasetInventoryCell,
  DatasetInventoryHeader,
  DatasetInventoryPanel,
  DatasetInventoryScroller,
  DatasetInventoryTable,
  DatasetInventoryTd,
  DatasetInventoryTh,
  DatasetInventoryToolbar,
  DatasetInventoryUploadInput,
} from "./styles";
import { MetaText } from "../app/styles";
import { downloadWorkspaceFile, formatByteSize, openWorkspaceFileInNewTab } from "../lib/workspace-artifacts";
import { normalizePathPrefix } from "../lib/workspace-fs";
import type { LocalWorkspaceFile } from "../types/report";
import type { WorkspaceBreadcrumb, WorkspaceFileNode, WorkspaceFilesystem, WorkspaceItem } from "../types/workspace";

const CSV_PREVIEW_LIMIT = 6;
const JSON_PREVIEW_LIMIT = 12;
const TEXT_PREVIEW_LIMIT = 4_000;

type WorkspaceBranchNode = {
  id: string;
  kind: "branch";
  name: string;
  path: string;
  childBranchIds: string[];
  childFileIds: string[];
};

type WorkspaceTreeNode = WorkspaceBranchNode | WorkspaceFileNode;

function withTrailingSlash(prefix: string): string {
  if (!prefix || prefix === "/") {
    return "/";
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function branchId(prefix: string): string {
  return `branch:${withTrailingSlash(prefix)}`;
}

function branchName(prefix: string): string {
  if (prefix === "/") {
    return "/";
  }
  return prefix.replace(/\/$/, "").split("/").filter(Boolean).at(-1) ?? "/";
}

function parentPrefix(prefix: string): string | null {
  const normalized = normalizePathPrefix(prefix);
  if (normalized === "/") {
    return null;
  }
  const parts = normalized.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}/`;
}

function parentPrefixForFile(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}/`;
}

function compareBranches(left: WorkspaceBranchNode, right: WorkspaceBranchNode): number {
  if (left.path === "/") {
    return -1;
  }
  if (right.path === "/") {
    return 1;
  }
  return left.name.localeCompare(right.name);
}

function compareFiles(left: WorkspaceFileNode, right: WorkspaceFileNode): number {
  return left.name.localeCompare(right.name);
}

function renderFilePreview(file: LocalWorkspaceFile) {
  if (file.kind === "csv") {
    const previewRows = file.preview_rows.slice(0, CSV_PREVIEW_LIMIT);
    return (
      <WorkspacePreviewSection>
        <WorkspacePreviewSectionHeader>
          <strong>Table preview</strong>
          <MetaText>Showing the first {previewRows.length} preview rows.</MetaText>
        </WorkspacePreviewSectionHeader>
        <WorkspaceStatGrid>
          <WorkspaceStatCard>
            <strong>{file.row_count}</strong>
            <MetaText>Rows</MetaText>
          </WorkspaceStatCard>
          <WorkspaceStatCard>
            <strong>{file.columns.length}</strong>
            <MetaText>Columns</MetaText>
          </WorkspaceStatCard>
          <WorkspaceStatCard>
            <strong>{file.numeric_columns.length}</strong>
            <MetaText>Numeric columns</MetaText>
          </WorkspaceStatCard>
        </WorkspaceStatGrid>
        <MetaText>Columns: {file.columns.join(", ")}</MetaText>
        <DatasetInventoryScroller>
          <DatasetInventoryTable>
            <thead>
              <tr>
                {file.columns.map((column) => (
                  <DatasetInventoryTh key={column}>{column}</DatasetInventoryTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr key={`${file.id}-${rowIndex}`}>
                  {file.columns.map((column) => (
                    <DatasetInventoryTd key={`${file.id}-${rowIndex}-${column}`}>
                      <DatasetInventoryCell>{row[column] ?? ""}</DatasetInventoryCell>
                    </DatasetInventoryTd>
                  ))}
                </tr>
              ))}
            </tbody>
          </DatasetInventoryTable>
        </DatasetInventoryScroller>
      </WorkspacePreviewSection>
    );
  }

  if (file.kind === "json") {
    return (
      <WorkspacePreviewSection>
        <WorkspacePreviewSectionHeader>
          <strong>JSON preview</strong>
          <MetaText>Showing the first {Math.min(file.row_count, JSON_PREVIEW_LIMIT)} rows.</MetaText>
        </WorkspacePreviewSectionHeader>
        <WorkspaceStatGrid>
          <WorkspaceStatCard>
            <strong>{file.row_count}</strong>
            <MetaText>Rows</MetaText>
          </WorkspaceStatCard>
          <WorkspaceStatCard>
            <strong>{file.columns.length}</strong>
            <MetaText>Columns</MetaText>
          </WorkspaceStatCard>
          <WorkspaceStatCard>
            <strong>{formatByteSize(file.byte_size)}</strong>
            <MetaText>Size</MetaText>
          </WorkspaceStatCard>
        </WorkspaceStatGrid>
        <MetaText>Columns: {file.columns.join(", ")}</MetaText>
        <WorkspaceCodeBlock>
          {JSON.stringify(file.rows.slice(0, JSON_PREVIEW_LIMIT), null, 2)}
        </WorkspaceCodeBlock>
      </WorkspacePreviewSection>
    );
  }

  if (file.kind === "pdf") {
    return (
      <WorkspacePreviewSection>
        <WorkspacePreviewSectionHeader>
          <strong>PDF summary</strong>
          <MetaText>Use "Open file" to inspect the document in a new tab.</MetaText>
        </WorkspacePreviewSectionHeader>
        <WorkspaceStatGrid>
          <WorkspaceStatCard>
            <strong>{file.page_count}</strong>
            <MetaText>Pages</MetaText>
          </WorkspaceStatCard>
          <WorkspaceStatCard>
            <strong>{formatByteSize(file.byte_size)}</strong>
            <MetaText>Size</MetaText>
          </WorkspaceStatCard>
        </WorkspaceStatGrid>
      </WorkspacePreviewSection>
    );
  }

  if (file.text_content != null) {
    return (
      <WorkspacePreviewSection>
        <WorkspacePreviewSectionHeader>
          <strong>Text preview</strong>
          <MetaText>Showing the first {Math.min(file.text_content.length, TEXT_PREVIEW_LIMIT)} characters.</MetaText>
        </WorkspacePreviewSectionHeader>
        <WorkspaceTextBlock>{file.text_content.slice(0, TEXT_PREVIEW_LIMIT)}</WorkspaceTextBlock>
      </WorkspacePreviewSection>
    );
  }

  return (
    <WorkspacePreviewSection>
      <WorkspacePreviewSectionHeader>
        <strong>Binary file</strong>
        <MetaText>Download this file to inspect it locally.</MetaText>
      </WorkspacePreviewSectionHeader>
    </WorkspacePreviewSection>
  );
}

function buildTreeModel(filesystem: WorkspaceFilesystem, activePrefix: string): {
  branchById: Map<string, WorkspaceBranchNode>;
  fileById: Map<string, WorkspaceFileNode>;
  rootBranch: WorkspaceBranchNode;
} {
  const branchById = new Map<string, WorkspaceBranchNode>();
  const fileById = new Map<string, WorkspaceFileNode>();

  function ensureBranch(prefix: string): WorkspaceBranchNode {
    const normalizedPrefix = withTrailingSlash(normalizePathPrefix(prefix));
    const id = branchId(normalizedPrefix);
    const existing = branchById.get(id);
    if (existing) {
      return existing;
    }
    const nextBranch: WorkspaceBranchNode = {
      id,
      kind: "branch",
      name: branchName(normalizedPrefix),
      path: normalizedPrefix,
      childBranchIds: [],
      childFileIds: [],
    };
    branchById.set(id, nextBranch);
    const parent = parentPrefix(normalizedPrefix);
    if (parent) {
      const parentBranch = ensureBranch(parent);
      if (!parentBranch.childBranchIds.includes(id)) {
        parentBranch.childBranchIds.push(id);
      }
    }
    return nextBranch;
  }

  const rootBranch = ensureBranch("/");
  const files = Object.values(filesystem.files_by_path ?? {}).sort((left, right) => left.path.localeCompare(right.path));

  for (const file of files) {
    fileById.set(file.id, file);
    const parent = ensureBranch(parentPrefixForFile(file.path));
    if (!parent.childFileIds.includes(file.id)) {
      parent.childFileIds.push(file.id);
    }
  }

  ensureBranch(activePrefix);

  for (const branch of branchById.values()) {
    branch.childBranchIds.sort((leftId, rightId) => {
      const left = branchById.get(leftId);
      const right = branchById.get(rightId);
      return left && right ? compareBranches(left, right) : 0;
    });
    branch.childFileIds.sort((leftId, rightId) => {
      const left = fileById.get(leftId);
      const right = fileById.get(rightId);
      return left && right ? compareFiles(left, right) : 0;
    });
  }

  return { branchById, fileById, rootBranch };
}

export function WorkspaceInventoryPane({
  activePrefix,
  cwdPath,
  filesystem,
  breadcrumbs,
  entries,
  accept,
  onSelectFiles,
  onChangeDirectory,
  onRemoveEntry,
}: {
  activePrefix: string;
  cwdPath: string;
  filesystem: WorkspaceFilesystem;
  breadcrumbs: WorkspaceBreadcrumb[];
  entries: WorkspaceItem[];
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onCreateDirectory?: (path: string) => void;
  onChangeDirectory: (path: string) => void;
  onRemoveEntry?: (entryId: string) => void;
}) {
  const normalizedActivePrefix = useMemo(() => withTrailingSlash(normalizePathPrefix(activePrefix || cwdPath)), [activePrefix, cwdPath]);
  const [prefixInput, setPrefixInput] = useState("");
  const { branchById, fileById, rootBranch } = useMemo(
    () => buildTreeModel(filesystem, normalizedActivePrefix),
    [filesystem, normalizedActivePrefix],
  );
  const activeBranchId = useMemo(() => branchId(normalizedActivePrefix), [normalizedActivePrefix]);
  const [expandedBranchIds, setExpandedBranchIds] = useState<Set<string>>(
    () => new Set([branchId("/"), activeBranchId]),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(activeBranchId);

  const currentPathBranchIds = useMemo(() => {
    const ids = new Set<string>([branchId("/")]);
    let cursor: string | null = normalizedActivePrefix;
    while (cursor) {
      ids.add(branchId(cursor));
      cursor = parentPrefix(cursor);
    }
    return ids;
  }, [normalizedActivePrefix]);

  useEffect(() => {
    setExpandedBranchIds((current) => {
      const next = new Set(current);
      for (const id of currentPathBranchIds) {
        next.add(id);
      }
      return next;
    });
  }, [currentPathBranchIds]);

  useEffect(() => {
    setSelectedNodeId((current) => {
      if (current?.startsWith("branch:")) {
        return branchById.has(current) ? current : activeBranchId;
      }
      return fileById.has(current) ? current : activeBranchId;
    });
  }, [activeBranchId, branchById, fileById]);

  const treeRows = useMemo(() => {
    const rows: Array<{ node: WorkspaceTreeNode; depth: number; expanded: boolean; childCount: number }> = [];

    function walk(branch: WorkspaceBranchNode, depth: number) {
      const expanded = branch.id === rootBranch.id || expandedBranchIds.has(branch.id);
      const childCount = branch.childBranchIds.length + branch.childFileIds.length;
      rows.push({ node: branch, depth, expanded, childCount });
      if (!expanded) {
        return;
      }
      for (const childBranchId of branch.childBranchIds) {
        const childBranch = branchById.get(childBranchId);
        if (childBranch) {
          walk(childBranch, depth + 1);
        }
      }
      for (const childFileId of branch.childFileIds) {
        const childFile = fileById.get(childFileId);
        if (childFile) {
          rows.push({ node: childFile, depth: depth + 1, expanded: false, childCount: 0 });
        }
      }
    }

    walk(rootBranch, 0);
    return rows;
  }, [branchById, expandedBranchIds, fileById, rootBranch]);

  const selectedNode = useMemo<WorkspaceTreeNode>(() => {
    if (selectedNodeId.startsWith("branch:")) {
      return branchById.get(selectedNodeId) ?? rootBranch;
    }
    return fileById.get(selectedNodeId) ?? branchById.get(activeBranchId) ?? rootBranch;
  }, [activeBranchId, branchById, fileById, rootBranch, selectedNodeId]);

  const selectedBranchChildren = useMemo(() => {
    if (selectedNode.kind !== "branch") {
      return { branches: [] as WorkspaceBranchNode[], files: [] as WorkspaceFileNode[] };
    }
    return {
      branches: selectedNode.childBranchIds
        .map((id) => branchById.get(id))
        .filter((branch): branch is WorkspaceBranchNode => branch !== undefined),
      files: selectedNode.childFileIds
        .map((id) => fileById.get(id))
        .filter((file): file is WorkspaceFileNode => file !== undefined),
    };
  }, [branchById, fileById, selectedNode]);

  const selectedBranchSubtreeFiles = useMemo(() => {
    if (selectedNode.kind !== "branch") {
      return 0;
    }
    const normalizedPrefix = withTrailingSlash(selectedNode.path);
    return Array.from(fileById.values()).filter((file) => file.path.startsWith(normalizedPrefix === "/" ? "/" : normalizedPrefix)).length;
  }, [fileById, selectedNode]);

  function toggleBranch(nodeId: string) {
    if (nodeId === rootBranch.id || currentPathBranchIds.has(nodeId)) {
      return;
    }
    setExpandedBranchIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function handlePrefixSubmit() {
    const trimmed = prefixInput.trim();
    if (!trimmed) {
      return;
    }
    const nextPrefix = trimmed.startsWith("/") ? trimmed : `${normalizedActivePrefix}${trimmed}`;
    onChangeDirectory(nextPrefix);
    setPrefixInput("");
  }

  return (
    <DatasetInventoryPanel>
      <DatasetInventoryHeader>
        <h2>Workspace files</h2>
        <MetaText>
          Browse the workspace from the root, synthesize a tree from file paths, and inspect the selected prefix or file beside the tree.
        </MetaText>
      </DatasetInventoryHeader>

      <DatasetInventoryToolbar>
        <DatasetInventoryUploadInput
          type="file"
          accept={accept}
          multiple
          onChange={(event) => {
            void onSelectFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <WorkspacePathBadge>Active prefix: {normalizedActivePrefix}</WorkspacePathBadge>
        <WorkspacePathBadge>{entries.length} visible file{entries.length === 1 ? "" : "s"}</WorkspacePathBadge>
      </DatasetInventoryToolbar>

      <WorkspaceBreadcrumbRow aria-label="Workspace breadcrumbs">
        {breadcrumbs.map((breadcrumb, index) => (
          <WorkspaceBreadcrumbFragment key={breadcrumb.id}>
            <WorkspaceBreadcrumbButton
              type="button"
              onClick={() => onChangeDirectory(breadcrumb.prefix)}
              disabled={breadcrumb.prefix === normalizedActivePrefix}
            >
              {breadcrumb.name}
            </WorkspaceBreadcrumbButton>
            {index < breadcrumbs.length - 1 ? <WorkspaceBreadcrumbSeparator>/</WorkspaceBreadcrumbSeparator> : null}
          </WorkspaceBreadcrumbFragment>
        ))}
      </WorkspaceBreadcrumbRow>

      <DatasetInventoryToolbar>
        <WorkspacePathButton
          type="button"
          onClick={() => onChangeDirectory(parentPrefix(normalizedActivePrefix) ?? "/")}
          disabled={normalizedActivePrefix === "/"}
        >
          Up one level
        </WorkspacePathButton>
        <WorkspaceInput
          type="text"
          value={prefixInput}
          onChange={(event) => setPrefixInput(event.target.value)}
          placeholder="Focus another prefix"
        />
        <DatasetInventoryButton type="button" onClick={handlePrefixSubmit} disabled={!prefixInput.trim()}>
          Set prefix
        </DatasetInventoryButton>
      </DatasetInventoryToolbar>

      <WorkspaceBrowserLayout>
        <WorkspaceBrowserTreePanel>
          <WorkspacePanelHeader>
            <strong>Path tree</strong>
            <MetaText>Anchored at /. Branch nodes are derived from file paths and selecting one updates the active prefix.</MetaText>
          </WorkspacePanelHeader>
          <WorkspaceTreeScroller>
            <WorkspaceTree role="tree" aria-label="Workspace filesystem tree">
              {treeRows.map(({ node, depth, expanded, childCount }) => {
                if (node.kind === "branch") {
                  const isSelected = selectedNode.id === node.id;
                  const isCurrentPrefix = node.path === normalizedActivePrefix;
                  const isPinnedOpen = currentPathBranchIds.has(node.id);
                  const expandable = childCount > 0;
                  return (
                    <WorkspaceTreeRow key={node.id}>
                      <WorkspaceTreeRowInner>
                        <WorkspaceTreeExpandButton
                          type="button"
                          onClick={() => toggleBranch(node.id)}
                          disabled={!expandable || node.id === rootBranch.id || isPinnedOpen}
                          aria-label={
                            expandable
                              ? `${expanded ? "Collapse" : "Expand"} ${node.name}`
                              : `${node.name} has no children`
                          }
                        >
                          {expandable ? (expanded ? "v" : ">") : ""}
                        </WorkspaceTreeExpandButton>
                        <WorkspaceTreeNodeButton
                          type="button"
                          role="treeitem"
                          aria-selected={isSelected}
                          aria-expanded={expanded}
                          $depth={depth}
                          $selected={isSelected}
                          $currentDirectory={isCurrentPrefix}
                          onClick={() => {
                            setSelectedNodeId(node.id);
                            onChangeDirectory(node.path);
                          }}
                        >
                          <WorkspaceTreeLabelRow>
                            <strong>{node.name}</strong>
                            <WorkspaceInlineBadge $tone={isCurrentPrefix ? "accent" : "default"}>
                              {isCurrentPrefix ? "active" : "prefix"}
                            </WorkspaceInlineBadge>
                          </WorkspaceTreeLabelRow>
                          <MetaText as="span">{node.path}</MetaText>
                        </WorkspaceTreeNodeButton>
                      </WorkspaceTreeRowInner>
                    </WorkspaceTreeRow>
                  );
                }

                const isSelected = selectedNode.id === node.id;
                return (
                  <WorkspaceTreeRow key={node.id}>
                    <WorkspaceTreeRowInner>
                      <WorkspaceTreeExpandButton type="button" disabled aria-label={`${node.name} has no children`} />
                      <WorkspaceTreeNodeButton
                        type="button"
                        role="treeitem"
                        aria-selected={isSelected}
                        $depth={depth}
                        $selected={isSelected}
                        $currentDirectory={false}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <WorkspaceTreeLabelRow>
                          <strong>{node.file.name}</strong>
                          <WorkspaceInlineBadge>{node.file.kind}</WorkspaceInlineBadge>
                        </WorkspaceTreeLabelRow>
                        <MetaText as="span">{node.path}</MetaText>
                      </WorkspaceTreeNodeButton>
                    </WorkspaceTreeRowInner>
                  </WorkspaceTreeRow>
                );
              })}
            </WorkspaceTree>
          </WorkspaceTreeScroller>
        </WorkspaceBrowserTreePanel>

        <WorkspaceBrowserPreviewPanel>
          <WorkspacePanelHeader>
            <strong>Selection preview</strong>
            <MetaText>{selectedNode.kind === "branch" ? "Prefix details" : "File details and inline preview"}</MetaText>
          </WorkspacePanelHeader>

          <WorkspacePreviewScroller>
            <WorkspacePreviewCard>
              <WorkspacePreviewHero>
                <div>
                  <WorkspacePreviewTitle>{selectedNode.kind === "branch" ? selectedNode.name : selectedNode.file.name}</WorkspacePreviewTitle>
                  <WorkspacePreviewPath>{selectedNode.path}</WorkspacePreviewPath>
                </div>
                <WorkspaceBadgeRow>
                  <WorkspaceInlineBadge $tone={selectedNode.kind === "branch" && selectedNode.path === normalizedActivePrefix ? "accent" : "default"}>
                    {selectedNode.kind === "branch" ? "prefix" : `${selectedNode.file.kind} file`}
                  </WorkspaceInlineBadge>
                  {selectedNode.kind === "branch" && selectedNode.path === normalizedActivePrefix ? (
                    <WorkspaceInlineBadge $tone="accent">active prefix</WorkspaceInlineBadge>
                  ) : null}
                  {selectedNode.kind === "file" ? (
                    <WorkspaceInlineBadge>{formatByteSize(selectedNode.file.byte_size)}</WorkspaceInlineBadge>
                  ) : null}
                </WorkspaceBadgeRow>
              </WorkspacePreviewHero>

              {selectedNode.kind === "branch" ? (
                <>
                  <WorkspaceStatGrid>
                    <WorkspaceStatCard>
                      <strong>{selectedBranchChildren.branches.length}</strong>
                      <MetaText>Child prefixes</MetaText>
                    </WorkspaceStatCard>
                    <WorkspaceStatCard>
                      <strong>{selectedBranchChildren.files.length}</strong>
                      <MetaText>Direct files</MetaText>
                    </WorkspaceStatCard>
                    <WorkspaceStatCard>
                      <strong>{selectedBranchSubtreeFiles}</strong>
                      <MetaText>Files in subtree</MetaText>
                    </WorkspaceStatCard>
                  </WorkspaceStatGrid>

                  <WorkspacePreviewNote>
                    Uploads and new derived files resolve against the current active prefix: {normalizedActivePrefix}
                  </WorkspacePreviewNote>

                  <WorkspacePreviewSection>
                    <WorkspacePreviewSectionHeader>
                      <strong>Direct contents</strong>
                      <MetaText>
                        {selectedBranchChildren.branches.length || selectedBranchChildren.files.length
                          ? "Selecting a prefix in the tree also scopes the visible file listing."
                          : "No files currently live under this prefix."}
                      </MetaText>
                    </WorkspacePreviewSectionHeader>
                    {selectedBranchChildren.branches.length || selectedBranchChildren.files.length ? (
                      <WorkspaceMiniList>
                        {selectedBranchChildren.branches.map((branch) => (
                          <WorkspaceMiniListItem key={branch.id}>
                            <span>{branch.name}/</span>
                            <MetaText as="span">prefix</MetaText>
                          </WorkspaceMiniListItem>
                        ))}
                        {selectedBranchChildren.files.map((file) => (
                          <WorkspaceMiniListItem key={file.id}>
                            <span>{file.file.name}</span>
                            <MetaText as="span">{file.file.kind}</MetaText>
                          </WorkspaceMiniListItem>
                        ))}
                      </WorkspaceMiniList>
                    ) : null}
                  </WorkspacePreviewSection>
                </>
              ) : (
                <>
                  <WorkspaceStatGrid>
                    {selectedNode.file.kind === "csv" || selectedNode.file.kind === "json" ? (
                      <>
                        <WorkspaceStatCard>
                          <strong>{selectedNode.file.row_count}</strong>
                          <MetaText>Rows</MetaText>
                        </WorkspaceStatCard>
                        <WorkspaceStatCard>
                          <strong>{selectedNode.file.columns.length}</strong>
                          <MetaText>Columns</MetaText>
                        </WorkspaceStatCard>
                      </>
                    ) : null}
                    {selectedNode.file.kind === "pdf" ? (
                      <WorkspaceStatCard>
                        <strong>{selectedNode.file.page_count}</strong>
                        <MetaText>Pages</MetaText>
                      </WorkspaceStatCard>
                    ) : null}
                    <WorkspaceStatCard>
                      <strong>{parentPrefixForFile(selectedNode.path)}</strong>
                      <MetaText>Parent prefix</MetaText>
                    </WorkspaceStatCard>
                  </WorkspaceStatGrid>

                  <DatasetInventoryToolbar>
                    {selectedNode.file.kind === "pdf" ||
                    selectedNode.file.kind === "json" ||
                    (selectedNode.file.kind === "other" && selectedNode.file.text_content != null) ? (
                      <DatasetInventoryButton onClick={() => openWorkspaceFileInNewTab(selectedNode.file)} type="button">
                        Open file
                      </DatasetInventoryButton>
                    ) : null}
                    <DatasetInventoryButton onClick={() => downloadWorkspaceFile(selectedNode.file)} type="button">
                      Download file
                    </DatasetInventoryButton>
                    {onRemoveEntry ? (
                      <DatasetInventoryButton type="button" onClick={() => onRemoveEntry(selectedNode.id)}>
                        Remove file
                      </DatasetInventoryButton>
                    ) : null}
                  </DatasetInventoryToolbar>

                  {renderFilePreview(selectedNode.file)}
                </>
              )}
            </WorkspacePreviewCard>
          </WorkspacePreviewScroller>
        </WorkspaceBrowserPreviewPanel>
      </WorkspaceBrowserLayout>
    </DatasetInventoryPanel>
  );
}

const WorkspaceInput = styled.input`
  min-width: 220px;
  padding: 0.72rem 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--ink);
`;

const WorkspacePathBadge = styled.div`
  padding: 0.72rem 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--panel-strong);
  color: var(--ink);
  font: inherit;
`;

const WorkspacePathButton = styled(DatasetInventoryButton)``;

const WorkspaceBreadcrumbRow = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
`;

const WorkspaceBreadcrumbFragment = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
`;

const WorkspaceBreadcrumbButton = styled.button`
  border: none;
  background: transparent;
  color: var(--accent-deep);
  font: inherit;
  padding: 0;
  cursor: pointer;

  &:disabled {
    color: var(--ink);
    cursor: default;
    font-weight: 600;
  }
`;

const WorkspaceBreadcrumbSeparator = styled.span`
  color: var(--muted);
`;

const WorkspaceBrowserLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(360px, 1.25fr);
  gap: 1rem;
  min-height: 0;

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }
`;

const WorkspaceBrowserTreePanel = styled.section`
  display: grid;
  gap: 0.75rem;
  min-height: 0;
`;

const WorkspaceBrowserPreviewPanel = styled.section`
  display: grid;
  gap: 0.75rem;
  min-height: 0;
`;

const WorkspacePanelHeader = styled.div`
  display: grid;
  gap: 0.25rem;
`;

const WorkspaceTreeScroller = styled.div`
  min-height: 420px;
  max-height: min(64vh, 720px);
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.7);
`;

const WorkspaceTree = styled.div`
  display: grid;
  gap: 0.2rem;
  padding: 0.55rem;
`;

const WorkspaceTreeRow = styled.div`
  display: grid;
`;

const WorkspaceTreeRowInner = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.2rem;
  align-items: start;
`;

const WorkspaceTreeExpandButton = styled.button`
  width: 1.8rem;
  min-height: 2.45rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const WorkspaceTreeNodeButton = styled.button<{
  $depth: number;
  $selected: boolean;
  $currentDirectory: boolean;
}>`
  display: grid;
  gap: 0.18rem;
  width: 100%;
  border: 1px solid
    ${({ $selected, $currentDirectory }) =>
      $selected
        ? "color-mix(in srgb, var(--accent) 42%, rgba(31, 41, 55, 0.12))"
        : $currentDirectory
          ? "color-mix(in srgb, var(--accent-deep) 26%, rgba(31, 41, 55, 0.12))"
          : "transparent"};
  border-radius: var(--radius-md);
  background: ${({ $selected, $currentDirectory }) =>
    $selected
      ? "color-mix(in srgb, var(--accent-soft) 62%, white 38%)"
      : $currentDirectory
        ? "color-mix(in srgb, var(--accent-soft) 35%, white 65%)"
        : "transparent"};
  color: var(--ink);
  text-align: left;
  padding: 0.55rem 0.7rem 0.55rem ${({ $depth }) => 0.7 + $depth * 0.85}rem;
  cursor: pointer;
`;

const WorkspaceTreeLabelRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const WorkspaceInlineBadge = styled.span<{ $tone?: "default" | "accent" }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.5rem;
  border: 1px solid
    ${({ $tone }) => ($tone === "accent" ? "color-mix(in srgb, var(--accent) 34%, rgba(31, 41, 55, 0.1))" : "var(--line)")};
  background: ${({ $tone }) =>
    $tone === "accent" ? "color-mix(in srgb, var(--accent-soft) 72%, white 28%)" : "rgba(255, 255, 255, 0.72)"};
  color: ${({ $tone }) => ($tone === "accent" ? "var(--accent-deep)" : "var(--muted)")};
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  text-transform: lowercase;
`;

const WorkspacePreviewScroller = styled.div`
  min-height: 420px;
  max-height: min(64vh, 720px);
  overflow: auto;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.7);
`;

const WorkspacePreviewCard = styled.div`
  display: grid;
  gap: 1rem;
  padding: 1rem;
`;

const WorkspacePreviewHero = styled.div`
  display: grid;
  gap: 0.65rem;
`;

const WorkspacePreviewTitle = styled.h3`
  margin: 0;
  font-size: 1.1rem;
`;

const WorkspacePreviewPath = styled(MetaText)`
  word-break: break-word;
`;

const WorkspaceBadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;

const WorkspaceStatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.75rem;
`;

const WorkspaceStatCard = styled.div`
  display: grid;
  gap: 0.15rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.72);

  strong {
    font-size: 0.98rem;
    word-break: break-word;
  }
`;

const WorkspacePreviewSection = styled.section`
  display: grid;
  gap: 0.75rem;
`;

const WorkspacePreviewSectionHeader = styled.div`
  display: grid;
  gap: 0.2rem;
`;

const WorkspaceCodeBlock = styled.pre`
  margin: 0;
  max-height: 360px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(20, 24, 31, 0.94);
  color: #eff8ff;
  padding: 0.85rem 0.95rem;
  font-size: 0.76rem;
  line-height: 1.45;
`;

const WorkspaceTextBlock = styled.pre`
  margin: 0;
  max-height: 360px;
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.84);
  color: var(--ink);
  padding: 0.85rem 0.95rem;
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const WorkspacePreviewNote = styled(MetaText)`
  align-self: center;
`;

const WorkspaceMiniList = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const WorkspaceMiniListItem = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.72);

  span:first-child {
    font-weight: 600;
    word-break: break-word;
  }
`;
