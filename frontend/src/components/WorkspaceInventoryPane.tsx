import { useMemo, useState } from "react";
import styled from "styled-components";

import {
  DatasetInventoryButton,
  DatasetInventoryCard,
  DatasetInventoryExpanded,
  DatasetInventoryHeader,
  DatasetInventoryList,
  DatasetInventoryMetaRow,
  DatasetInventoryPanel,
  DatasetInventoryToggle,
  DatasetInventoryToolbar,
  DatasetInventoryUploadInput,
} from "./styles";
import { MetaText } from "../app/styles";
import { downloadWorkspaceFile, openWorkspaceFileInNewTab } from "../lib/workspace-artifacts";
import type { WorkspaceBreadcrumb, WorkspaceItem } from "../types/workspace";

export function WorkspaceInventoryPane({
  cwdPath,
  breadcrumbs,
  entries,
  accept,
  onSelectFiles,
  onCreateDirectory,
  onChangeDirectory,
  onRemoveEntry,
}: {
  cwdPath: string;
  breadcrumbs: WorkspaceBreadcrumb[];
  entries: WorkspaceItem[];
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onCreateDirectory: (path: string) => void;
  onChangeDirectory: (path: string) => void;
  onRemoveEntry?: (entryId: string) => void;
}) {
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [directoryName, setDirectoryName] = useState("");
  const expandedEntry = useMemo(
    () => entries.find((entry) => entry.id === expandedEntryId) ?? null,
    [entries, expandedEntryId],
  );

  function toggleEntry(entryId: string) {
    setExpandedEntryId((current) => (current === entryId ? null : entryId));
  }

  function handleCreateDirectory() {
    const trimmed = directoryName.trim();
    if (!trimmed) {
      return;
    }
    onCreateDirectory(trimmed);
    setDirectoryName("");
  }

  return (
    <DatasetInventoryPanel>
      <DatasetInventoryHeader>
        <h2>Workspace files</h2>
        <MetaText>Browse the current directory, create subdirectories, and upload files into the shared workspace.</MetaText>
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
        <WorkspacePathBadge>Current directory: {cwdPath}</WorkspacePathBadge>
      </DatasetInventoryToolbar>
      <WorkspaceBreadcrumbRow aria-label="Workspace breadcrumbs">
        {breadcrumbs.map((breadcrumb, index) => (
          <WorkspaceBreadcrumbFragment key={breadcrumb.id}>
            <WorkspaceBreadcrumbButton
              type="button"
              onClick={() => onChangeDirectory(breadcrumb.path)}
              disabled={breadcrumb.path === cwdPath}
            >
              {breadcrumb.name}
            </WorkspaceBreadcrumbButton>
            {index < breadcrumbs.length - 1 ? <WorkspaceBreadcrumbSeparator>/</WorkspaceBreadcrumbSeparator> : null}
          </WorkspaceBreadcrumbFragment>
        ))}
      </WorkspaceBreadcrumbRow>
      <DatasetInventoryToolbar>
        <WorkspacePathButton type="button" onClick={() => onChangeDirectory("..")} disabled={cwdPath === "/"}>
          Up one level
        </WorkspacePathButton>
        <WorkspaceInput
          type="text"
          value={directoryName}
          onChange={(event) => setDirectoryName(event.target.value)}
          placeholder="Create directory"
        />
        <DatasetInventoryButton type="button" onClick={handleCreateDirectory} disabled={!directoryName.trim()}>
          Create directory
        </DatasetInventoryButton>
      </DatasetInventoryToolbar>
      {entries.length ? (
        <DatasetInventoryList>
          {entries.map((entry) => {
            const isExpanded = expandedEntry?.id === entry.id;
            const meta =
              entry.kind === "directory"
                ? "Directory"
                : `${entry.file.kind.toUpperCase()}${entry.file.extension ? ` • ${entry.file.extension}` : ""}`;
            return (
              <DatasetInventoryCard key={entry.id}>
                <DatasetInventoryToggle onClick={() => toggleEntry(entry.id)} type="button">
                  <strong>{entry.kind === "directory" ? entry.name || "/" : entry.file.name}</strong>
                  <DatasetInventoryMetaRow>
                    <MetaText as="span">{meta}</MetaText>
                    <MetaText as="span">{entry.path}</MetaText>
                    {entry.kind === "file" && (entry.file.kind === "csv" || entry.file.kind === "json") ? (
                      <MetaText as="span">{entry.file.row_count} rows</MetaText>
                    ) : null}
                    {entry.kind === "file" && entry.file.kind === "pdf" ? (
                      <MetaText as="span">{entry.file.page_count} pages</MetaText>
                    ) : null}
                  </DatasetInventoryMetaRow>
                </DatasetInventoryToggle>
                {isExpanded ? (
                  <DatasetInventoryExpanded>
                    {entry.kind === "directory" ? (
                      <>
                        <MetaText>Navigate into this directory to inspect or upload files there.</MetaText>
                        <DatasetInventoryToolbar>
                          <DatasetInventoryButton type="button" onClick={() => onChangeDirectory(entry.path)}>
                            Open directory
                          </DatasetInventoryButton>
                          {onRemoveEntry ? (
                            <DatasetInventoryButton type="button" onClick={() => onRemoveEntry(entry.id)}>
                              Remove directory
                            </DatasetInventoryButton>
                          ) : null}
                        </DatasetInventoryToolbar>
                      </>
                    ) : (
                      <>
                        <MetaText>Path: {entry.path}</MetaText>
                        <DatasetInventoryToolbar>
                          {entry.file.kind === "pdf" || entry.file.kind === "json" || (entry.file.kind === "other" && entry.file.text_content != null) ? (
                            <DatasetInventoryButton onClick={() => openWorkspaceFileInNewTab(entry.file)} type="button">
                              Open file
                            </DatasetInventoryButton>
                          ) : null}
                          <DatasetInventoryButton onClick={() => downloadWorkspaceFile(entry.file)} type="button">
                            Download file
                          </DatasetInventoryButton>
                          {onRemoveEntry ? (
                            <DatasetInventoryButton type="button" onClick={() => onRemoveEntry(entry.id)}>
                              Remove file
                            </DatasetInventoryButton>
                          ) : null}
                        </DatasetInventoryToolbar>
                      </>
                    )}
                  </DatasetInventoryExpanded>
                ) : null}
              </DatasetInventoryCard>
            );
          })}
        </DatasetInventoryList>
      ) : (
        <MetaText>No files or directories in this location yet.</MetaText>
      )}
    </DatasetInventoryPanel>
  );
}

const WorkspaceInput = styled.input`
  min-width: 180px;
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
