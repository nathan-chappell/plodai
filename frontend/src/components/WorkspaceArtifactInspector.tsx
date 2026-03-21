import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import {
  DatasetInventoryButton,
  DatasetInventoryCard,
  DatasetInventoryCell,
  DatasetInventoryExpanded,
  DatasetInventoryList,
  DatasetInventoryMetaRow,
  DatasetInventoryPageButton,
  DatasetInventoryPager,
  DatasetInventoryScroller,
  DatasetInventoryTable,
  DatasetInventoryTd,
  DatasetInventoryTh,
  DatasetInventoryToggle,
  DatasetInventoryToolbar,
} from "./styles";
import { downloadWorkspaceFile, formatByteSize, openWorkspaceFileInNewTab } from "../lib/workspace-artifacts";
import type { LocalWorkspaceFile } from "../types/report";

const PAGE_SIZE = 10;
const JSON_PREVIEW_LIMIT = 24;

export function WorkspaceArtifactInspector({
  files,
  emptyMessage = "No workspace artifacts yet.",
  compact = false,
}: {
  files: LocalWorkspaceFile[];
  emptyMessage?: string;
  compact?: boolean;
}) {
  const [expandedFileId, setExpandedFileId] = useState<string | null>(compact ? null : files[0]?.id ?? null);
  const [pageByFileId, setPageByFileId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!files.length) {
      setExpandedFileId(null);
      return;
    }
    setExpandedFileId((current) => {
      if (current && files.some((file) => file.id === current)) {
        return current;
      }
      return compact ? null : files[0].id;
    });
  }, [compact, files]);

  const expandedFile = useMemo(
    () => files.find((file) => file.id === expandedFileId) ?? null,
    [expandedFileId, files],
  );

  const currentPage = expandedFile ? pageByFileId[expandedFile.id] ?? 0 : 0;
  const pageCount =
    expandedFile?.kind === "csv" ? Math.max(1, Math.ceil(expandedFile.preview_rows.length / PAGE_SIZE)) : 1;
  const pagedRows =
    expandedFile?.kind === "csv"
      ? expandedFile.preview_rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
      : [];

  function toggleFile(fileId: string) {
    setExpandedFileId((current) => (current === fileId ? null : fileId));
    setPageByFileId((current) => ({ ...current, [fileId]: 0 }));
  }

  function setFilePage(fileId: string, nextPage: number) {
    setPageByFileId((current) => ({ ...current, [fileId]: nextPage }));
  }

  if (!files.length) {
    return <MetaText>{emptyMessage}</MetaText>;
  }

  return (
    <DatasetInventoryList>
      {files.map((file) => {
        const isExpanded = expandedFileId === file.id;
        const jsonPreview =
          file.kind === "json"
            ? JSON.stringify(file.rows.slice(0, JSON_PREVIEW_LIMIT), null, 2)
            : null;
        return (
          <CompactArtifactCard key={file.id} $compact={compact}>
            <DatasetInventoryToggle onClick={() => toggleFile(file.id)} type="button">
              <strong>{file.name}</strong>
              <DatasetInventoryMetaRow>
                <MetaText as="span">{file.kind.toUpperCase()}</MetaText>
                <MetaText as="span">{file.extension || "no extension"}</MetaText>
                <MetaText as="span">{formatByteSize(file.byte_size)}</MetaText>
                {file.kind === "csv" || file.kind === "json" ? <MetaText as="span">{file.row_count} rows</MetaText> : null}
                {file.kind === "csv" || file.kind === "json" ? <MetaText as="span">{file.columns.length} columns</MetaText> : null}
                {file.kind === "pdf" ? <MetaText as="span">{file.page_count} pages</MetaText> : null}
                {file.kind === "image" ? <MetaText as="span">{file.width}x{file.height}</MetaText> : null}
              </DatasetInventoryMetaRow>
            </DatasetInventoryToggle>

            {isExpanded ? (
              <DatasetInventoryExpanded>
                {file.kind === "csv" ? (
                  <>
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
                          {pagedRows.map((row, rowIndex) => (
                            <tr key={`${file.id}-${currentPage}-${rowIndex}`}>
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
                    <DatasetInventoryPager>
                      <DatasetInventoryPageButton
                        disabled={currentPage === 0}
                        onClick={() => setFilePage(file.id, Math.max(0, currentPage - 1))}
                        type="button"
                      >
                        Previous
                      </DatasetInventoryPageButton>
                      <MetaText>
                        Page {currentPage + 1} of {pageCount}
                      </MetaText>
                      <DatasetInventoryPageButton
                        disabled={currentPage >= pageCount - 1}
                        onClick={() => setFilePage(file.id, Math.min(pageCount - 1, currentPage + 1))}
                        type="button"
                      >
                        Next
                      </DatasetInventoryPageButton>
                    </DatasetInventoryPager>
                  </>
                ) : null}

                {file.kind === "json" ? (
                  <>
                    <MetaText>Columns: {file.columns.join(", ")}</MetaText>
                    <JsonPreview $compact={compact}>{jsonPreview}</JsonPreview>
                    {file.row_count > JSON_PREVIEW_LIMIT ? (
                      <MetaText>Showing the first {JSON_PREVIEW_LIMIT} rows from the JSON artifact.</MetaText>
                    ) : null}
                  </>
                ) : null}

                {file.kind === "pdf" ? (
                  <>
                    <MetaText>
                      PDF artifact with {file.page_count} pages and a size of {formatByteSize(file.byte_size)}.
                    </MetaText>
                    <MetaText>Open it in a new tab to inspect the document directly.</MetaText>
                  </>
                ) : null}

                {file.kind === "image" ? (
                  <>
                    <MetaText>
                      Image artifact sized {file.width} x {file.height}.
                    </MetaText>
                    <DatasetPreviewImage alt={file.name} src={`data:${file.mime_type || "image/png"};base64,${file.bytes_base64}`} />
                  </>
                ) : null}

                {file.kind === "other" ? (
                  <>
                    {file.text_content ? (
                      <TextPreview $compact={compact}>{file.text_content}</TextPreview>
                    ) : (
                      <MetaText>This is a binary artifact. Download it to inspect it locally.</MetaText>
                    )}
                  </>
                ) : null}

                <DatasetInventoryToolbar>
                  {file.kind === "pdf" || file.kind === "json" || file.kind === "image" || (file.kind === "other" && file.text_content != null) ? (
                    <DatasetInventoryButton onClick={() => openWorkspaceFileInNewTab(file)} type="button">
                      Open file
                    </DatasetInventoryButton>
                  ) : null}
                  <DatasetInventoryButton onClick={() => downloadWorkspaceFile(file)} type="button">
                    Download file
                  </DatasetInventoryButton>
                </DatasetInventoryToolbar>
              </DatasetInventoryExpanded>
            ) : null}
          </CompactArtifactCard>
        );
      })}
    </DatasetInventoryList>
  );
}

const CompactArtifactCard = styled(DatasetInventoryCard)<{ $compact: boolean }>`
  ${({ $compact }) =>
    $compact
      ? `
    border-radius: var(--radius-md);

    ${DatasetInventoryToggle} {
      padding: 0.72rem 0.85rem;
      gap: 0.2rem;
    }

    ${DatasetInventoryExpanded} {
      padding: 0.78rem 0.85rem;
      gap: 0.6rem;
    }
  `
      : ""}
`;

const JsonPreview = styled.pre<{ $compact: boolean }>`
  margin: 0;
  max-height: ${({ $compact }) => ($compact ? "180px" : "320px")};
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(20, 24, 31, 0.94);
  color: #eff8ff;
  padding: 0.85rem 0.95rem;
  font-size: 0.76rem;
  line-height: 1.45;
`;

const TextPreview = styled.pre<{ $compact: boolean }>`
  margin: 0;
  max-height: ${({ $compact }) => ($compact ? "180px" : "320px")};
  overflow: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink);
  padding: 0.85rem 0.95rem;
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const DatasetPreviewImage = styled.img`
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.72);
`;
