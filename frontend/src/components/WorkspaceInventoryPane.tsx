import { useMemo, useState } from "react";

import {
  DatasetInventoryButton,
  DatasetInventoryCard,
  DatasetInventoryCell,
  DatasetInventoryExpanded,
  DatasetInventoryHeader,
  DatasetInventoryList,
  DatasetInventoryMetaRow,
  DatasetInventoryPageButton,
  DatasetInventoryPager,
  DatasetInventoryPanel,
  DatasetInventoryScroller,
  DatasetInventoryTable,
  DatasetInventoryTd,
  DatasetInventoryTh,
  DatasetInventoryToggle,
  DatasetInventoryToolbar,
  DatasetInventoryUploadInput,
} from "./styles";
import { MetaText } from "../app/styles";
import type { LocalWorkspaceFile } from "../types/report";

const PAGE_SIZE = 10;

export function WorkspaceInventoryPane({
  files,
  accept,
  onSelectFiles,
  onClearFiles,
  onRemoveFile,
}: {
  files: LocalWorkspaceFile[];
  accept?: string;
  onSelectFiles: (files: FileList | null) => Promise<void>;
  onClearFiles: () => void;
  onRemoveFile?: (fileId: string) => void;
}) {
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [pageByFileId, setPageByFileId] = useState<Record<string, number>>({});

  const expandedFile = useMemo(
    () => files.find((file) => file.id === expandedFileId) ?? null,
    [expandedFileId, files],
  );

  const currentPage = expandedFile ? pageByFileId[expandedFile.id] ?? 0 : 0;
  const pageCount =
    expandedFile?.kind === "csv" || expandedFile?.kind === "json"
      ? Math.max(1, Math.ceil(expandedFile.preview_rows.length / PAGE_SIZE))
      : 1;
  const pagedRows =
    expandedFile?.kind === "csv" || expandedFile?.kind === "json"
      ? expandedFile.preview_rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
      : [];

  function toggleFile(fileId: string) {
    setExpandedFileId((current) => (current === fileId ? null : fileId));
    setPageByFileId((current) => ({ ...current, [fileId]: 0 }));
  }

  function setFilePage(fileId: string, nextPage: number) {
    setPageByFileId((current) => ({ ...current, [fileId]: nextPage }));
  }

  return (
    <DatasetInventoryPanel>
      <DatasetInventoryHeader>
        <h2>Workspace files</h2>
        <MetaText>Select local files, inspect safe metadata, and let the agent derive new files into the same workspace.</MetaText>
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
        <DatasetInventoryButton disabled={!files.length} onClick={onClearFiles} type="button">
          Remove all files
        </DatasetInventoryButton>
      </DatasetInventoryToolbar>
      {files.length ? (
        <DatasetInventoryList>
          {files.map((file) => {
            const isExpanded = expandedFileId === file.id;
            return (
              <DatasetInventoryCard key={file.id}>
                <DatasetInventoryToggle onClick={() => toggleFile(file.id)} type="button">
                  <strong>{file.name}</strong>
                  <DatasetInventoryMetaRow>
                    <MetaText as="span">{file.kind.toUpperCase()}</MetaText>
                    <MetaText as="span">{file.extension || "no extension"}</MetaText>
                    {file.kind === "csv" || file.kind === "json" ? <MetaText as="span">{file.row_count} rows</MetaText> : null}
                    {file.kind === "csv" || file.kind === "json" ? <MetaText as="span">{file.columns.length} columns</MetaText> : null}
                    {file.kind === "pdf" ? <MetaText as="span">{file.page_count} pages</MetaText> : null}
                  </DatasetInventoryMetaRow>
                </DatasetInventoryToggle>
                {isExpanded ? (
                  <DatasetInventoryExpanded>
                    {file.kind === "csv" || file.kind === "json" ? (
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
                    {file.kind === "pdf" ? (
                      <MetaText>
                        {file.page_count} pages available. Use the PDF tools to extract bounded page ranges into new workspace files.
                      </MetaText>
                    ) : null}
                    {file.kind === "other" ? (
                      <MetaText>
                        {file.text_content
                          ? "This derived file is available in the workspace."
                          : "This file is listed for awareness, but there are no specialized tools for it yet."}
                      </MetaText>
                    ) : null}
                    {onRemoveFile ? (
                      <DatasetInventoryButton onClick={() => onRemoveFile(file.id)} type="button">
                        Remove file
                      </DatasetInventoryButton>
                    ) : null}
                  </DatasetInventoryExpanded>
                ) : null}
              </DatasetInventoryCard>
            );
          })}
        </DatasetInventoryList>
      ) : (
        <MetaText>No workspace files yet.</MetaText>
      )}
    </DatasetInventoryPanel>
  );
}
